"use client";

import {
  PrivyProvider,
  useModalStatus,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { useClipboard } from "@astryxdesign/core/hooks";
import { publicEnv } from "@nymspace/core";
import { createContext, useContext, type ReactNode } from "react";

/**
 * The visitor, and what ENSv2 lets them do.
 *
 * Everything else in this console is signed by a key the visitor never sees, so
 * a denial on screen is the server reporting a denial — believable, and not the
 * same thing as verifiable. `docs/01`'s first success metric is that every
 * displayed permission is contract derived, and this is the one place a reader
 * can check that claim against an address they control rather than one the
 * deployment configured.
 *
 * ## Why the read is the whole feature
 *
 * A connected visitor holds no role on `nymspace.eth`, so the interesting
 * answer is already available without spending anything: `hasRoles` against
 * their address returns false for every capability, and the same request
 * returns true for the organization. No transaction, no gas, no faucet — the
 * authority boundary is a read, and making the visitor the subject of that read
 * is what turns it from an assertion into a check.
 *
 * Attempting the write instead would be stronger still and costs a funded
 * account plus a revert to interpret, which is `docs/21`'s scope-trap shape.
 * The matrix is the honest ninety percent.
 *
 * ## Degrading without the app id
 *
 * `privyAppId` is `optional()` in `env.public.ts` — the landing page, CI and
 * every clone without credentials must render. So the provider is conditional
 * and {@link useVisitor} answers `configured: false` rather than throwing,
 * because a console that white-screens when a sponsor variable is unset is
 * worse than one that quietly has no connect button.
 */

interface Visitor {
  /** Whether this deployment has a Privy app id at all. */
  configured: boolean;
  /**
   * Privy has resolved, *and* its connectors have finished reconnecting. Both,
   * because an address that has not arrived yet is indistinguishable from one
   * that is never coming — see {@link Bridge}.
   */
  ready: boolean;
  address: string | undefined;
  /** Opens the wallet picker and returns with an address. */
  connect: () => void;
  disconnect: () => void;
  /**
   * Privy's modal is on screen — the visitor is mid-connect.
   *
   * Published because the console has work that is only worth doing while
   * nobody is trying to connect. `DecryptGate` is the caller: its veil runs a
   * WebGL loop that never idles on its own, and the wallet handshake happening
   * over the top of it is the one moment that loop is both invisible to the
   * visitor and competing with something that matters.
   */
  connecting: boolean;
}

const UNCONFIGURED: Visitor = {
  configured: false,
  ready: true,
  address: undefined,
  connect: () => {},
  disconnect: () => {},
  connecting: false,
};

const VisitorContext = createContext<Visitor>(UNCONFIGURED);

export function useVisitor(): Visitor {
  return useContext(VisitorContext);
}

/**
 * Wraps the console when an app id exists, and is a pass-through when it does
 * not.
 *
 * Two components rather than one branch inside a single one: `usePrivy` may
 * only be called under a mounted `PrivyProvider`, and a hook called
 * conditionally is the rules-of-hooks violation React cannot recover from.
 */
export function VisitorProvider({ children }: { children: ReactNode }) {
  const appId = publicEnv().privyAppId;
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        /*
          Wallet first, because the subject of the read is an address. An email
          login mints an embedded wallet and would work identically, but the
          point lands hardest when the reader recognises the address as one they
          already had.
        */
        loginMethods: ["wallet", "email"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: {
          /*
            The modal opened on an email field with "Continue with a wallet"
            demoted to a second row, so reaching a wallet cost a click and a
            screen before anything wallet-shaped appeared. `loginMethods` orders
            the methods, not the modal; this orders the modal.
          */
          showWalletLoginFirst: true,
          /*
            Unset, this list is WalletConnect's entire catalogue — the picker
            said "Search through 596 wallets" and pulled a logo per row from
            `explorer-api.walletconnect.com`, a host this console has no
            relationship with and which is slow or unreachable from a good deal
            of the world. Nine image requests stood between a visitor and the
            button they came for.

            `wallet_connect_qr` rather than `wallet_connect`, which is the entry
            that *is* that catalogue: Privy's own documentation says it renders
            every wallet in the WalletConnect registry on desktop, so naming it
            here reproduced the problem the list was written to solve — verified
            against the deployed build, which still drew all 594. The `_qr` form
            is the transport on its own: one button, one code.

            Two entries, and the branded `metamask` one is deliberately not
            among them. That absence is the fix for the long "Waiting for
            MetaMask", so it needs the reason written down or someone will
            helpfully add it back.

            A named entry is a *wallet*, not a transport. Picking `metamask`
            from the list does not oblige Privy to use the extension sitting in
            the same browser: it can open a WalletConnect session and wait for
            MetaMask to collect it from the relay. That is the state this was
            reported in — the modal spinning on "Waiting for MetaMask" while the
            extension sat unlocked and idle with nothing pending, because
            nothing had been asked of it. A websocket to a relay in another
            hemisphere was being asked instead. The bundle carries both paths:
            `eip6963` and `relay.walletconnect` are each present in the shipped
            chunks.

            `detected_ethereum_wallets` resolves only to a provider that has
            announced itself in this page via EIP 6963, so it cannot involve a
            relay at all. Keeping `metamask` beside it would put two rows
            labelled MetaMask in front of the same visitor — one fast, one over
            the relay, indistinguishable before clicking. Removing it leaves one
            honest choice per situation: the extension when it is there, and an
            explicit QR when it is not.

            `detected_ethereum_wallets` rather than `detected_wallets`: the
            plain one is deprecated in favour of the per-chain pair, and this
            console is `walletChainType`'s `ethereum-only` default.
          */
          walletList: ["detected_ethereum_wallets", "wallet_connect_qr"],
        },
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

function Bridge({ children }: { children: ReactNode }) {
  const { ready: privyReady, authenticated, user, login, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { isOpen: connecting } = useModalStatus();

  /*
    `login`, not `connectWallet`, and the reason is disconnecting rather than
    connecting.

    Connecting is the cheaper call and this file used it for a while: it stops
    after `eth_requestAccounts`, where `login` goes on to fetch a nonce from
    /api/v1/siwe/init, raise a second wallet prompt for `personal_sign`, and
    post the signature to /api/v1/siwe/authenticate. Nothing here spends what
    that buys — no access token is read anywhere in this app — so on the way in
    it is pure cost.

    It is the way out that decides it. Privy implements no counterpart to
    `connectWallet`. `logout` is documented as clearing *authentication* state,
    and a connected wallet was never authenticated; searching the shipped SDK
    for a `logout` that tears down a connector finds nothing, in js-sdk-core or
    in any of react-auth's 196 chunks. `ConnectedWallet.disconnect` exists but
    is flagged experimental and documented to no-op for exactly the clients that
    matter, MetaMask named. So a connect-only session has no supported end: the
    wallet list stays populated, the address below stays set, and the Disconnect
    button does nothing at all — which is what shipped, and what this restores.

    `authenticated` is the flag `logout` does clear, so pairing `login` with it
    is the one arrangement where both halves of the control work. The second
    prompt is the price, and a control that silently fails is worse than a
    prompt. Worth revisiting only with a real wallet in hand to prove some other
    teardown works; the speed problem this file was opened for was the wallet
    picker's transport, fixed above and independent of this.
  */

  /*
    `user.wallet` first, `wallets[0]` second.

    They resolve at different times. `useWallets` builds its list from live
    connectors, which on a reload is empty for a moment while they reconnect,
    whereas `user.wallet` comes straight from the restored session. Reading only
    the list meant that after every reload the header showed "Connect" to
    someone who was still signed in — a false claim about their state, and the
    one thing this header exists to report.

    Gated on `authenticated`, which is not decoration: it is the only thing
    `logout` changes, so it is what makes Disconnect visible. Without the gate
    the address survives its own logout, because `wallets` is not cleared by
    anything.
  */
  const address = authenticated
    ? (user?.wallet?.address ?? wallets[0]?.address)
    : undefined;

  const value: Visitor = {
    configured: true,
    ready: privyReady && walletsReady,
    address,
    connect: login,
    disconnect: logout,
    connecting,
  };

  return <VisitorContext value={value}>{children}</VisitorContext>;
}

/**
 * The header control.
 *
 * Renders nothing at all when unconfigured — an always-disabled button is a
 * promise the deployment cannot keep, and reads as broken rather than as absent.
 */
export function ConnectVisitor() {
  const visitor = useVisitor();
  if (!visitor.configured) return null;

  if (!visitor.ready) {
    return (
      <Text type="code" size="2xs" color="secondary">
        …
      </Text>
    );
  }

  if (!visitor.address) {
    /*
      `primary`, not `secondary`.

      It was secondary while connecting was optional — a header affordance for
      the one screen that wanted a visitor's address. It is not optional any
      more: `DecryptGate` veils the console until this button has been pressed,
      so this is the only way past a screen the visitor cannot otherwise use,
      and a quiet outline beside a locked console is a way out that looks like
      chrome. The gate's own prompt carries the same control for the same
      reason; this one is where a visitor who has scrolled past it looks.

      It reverts to a plain address chip the moment it succeeds — nothing stays
      loud after the thing it was pointing at is done.
    */
    return (
      <Button
        size="sm"
        variant="primary"
        label="Connect"
        onClick={visitor.connect}
      />
    );
  }

  return (
    <HStack gap={2} align="center">
      <AddressChip address={visitor.address} />
      <Button
        size="sm"
        variant="ghost"
        label="Disconnect"
        onClick={visitor.disconnect}
      />
    </HStack>
  );
}

/**
 * The connected address, shortened, with the full one a click away.
 *
 * Bordered because it is a value and not a control, and the two sat side by
 * side as bare text before — a shortened hex string beside a ghost button reads
 * as two labels rather than as "here is who you are, and here is how to stop
 * being them". The border is what makes the address look deliberate rather than
 * like selected text.
 *
 * Copy rather than select: six characters and four are enough to recognise an
 * address and not enough to use one, so the shortened form is only ever a label
 * and the clipboard carries the whole thing.
 */
export function AddressChip({ address }: { address: string }) {
  // `useClipboard` owns the copied flag and its reset timer. Astryx's own note
  // on the hook is explicit that a second `useState` beside it is the mistake:
  // `isCopied` already resets itself, and a rapid re-copy restarts the window.
  const { copy, isCopied } = useClipboard({ announce: "Address copied" });

  return (
    <HStack
      gap={2}
      align="center"
      paddingInline={2}
      paddingBlock={1}
      className="rounded-lg border border-border"
    >
      {/*
        `sm`, not `2xs`. The table cells use `2xs` because density is the point
        there; in this header it resolved to eight pixels against the
        fourteen-pixel button beside it, and the address read as a caption under
        the control rather than as the thing the control acts on. `xsm` is ten,
        still short of it — `sm` is the first step that sits level.
      */}
      <Text type="code" size="sm" color="secondary">
        {address.slice(0, 6)}…{address.slice(-4)}
      </Text>
      <IconButton
        size="sm"
        variant="ghost"
        // The clipboard's own cue; see the note in `copyable-value.tsx`.
        data-sound="copy"
        // The tooltip stays "Copy"; the icon flip is the confirmation. The
        // label moves, because that is what a screen reader reads back.
        tooltip="Copy address"
        label={isCopied ? "Address copied" : "Copy address"}
        icon={<Icon icon={isCopied ? "check" : "copy"} size="xsm" />}
        onClick={() => void copy(address)}
      />
    </HStack>
  );
}
