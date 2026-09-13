"use client";

import {
  PrivyProvider,
  useConnectWallet,
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
  /**
   * Opens the wallet picker and returns with an address. Connect only: no
   * signature is requested and no session is created, because nothing in this
   * console consumes one. {@link Bridge} has the argument.
   */
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
            explicit `wallet_connect` QR when it is not.

            `detected_ethereum_wallets` rather than `detected_wallets`: the
            plain one is deprecated in favour of the per-chain pair, and this
            console is `walletChainType`'s `ethereum-only` default.
          */
          walletList: ["detected_ethereum_wallets", "wallet_connect"],
        },
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

function Bridge({ children }: { children: ReactNode }) {
  const { ready: privyReady, user, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { isOpen: connecting } = useModalStatus();
  /*
    Connect, not log in.

    `login()` authenticates: it opens the modal, takes `eth_requestAccounts`,
    then fetches a nonce from `/api/v1/siwe/init`, raises a *second* wallet
    prompt for `personal_sign`, and posts the signature back to
    `/api/v1/siwe/authenticate` before it will tell you an address. Two wallet
    prompts and two round-trips to Privy, and this console spends none of what
    they buy — nothing here reads an access token, calls `getAccessToken`, or
    sends a Privy identity anywhere. The one thing taken off the session is
    `address`, and the reads it feeds — `hasRoles` against ENSv2 — are public
    and unauthenticated by design. See this file's header: a visitor holds no
    role, and that is the whole point of letting them supply the subject.

    A signature would be worth its cost if something verified it. Proving
    control of the address would matter the moment the console let you *act* as
    it; the gate is about acting, but every act behind it is still signed by the
    server's own key. Until that changes this is a signature nobody checks, and
    charging a visitor two wallet prompts for it is charging them for nothing.

    `connectWallet` stops after `eth_requestAccounts`: one prompt, no nonce, no
    signature, no round-trip.
  */
  const { connectWallet } = useConnectWallet();

  /*
    `wallets[0]` first now, `user.wallet` second — the reverse of what stood
    here while this was a login.

    A connected wallet is not an authenticated one, so `authenticated` stays
    false and `user` stays null on the path above; the live connector list is
    the only place the address appears. `user.wallet` is kept behind it because
    a session authenticated before this change is still restorable, and reading
    it costs nothing.

    That inverts the hazard the old comment described. The list is empty for a
    moment on reload while connectors reconnect, and there is no restored
    session to cover the gap any more — so the gap is covered by not claiming to
    be ready during it. `useWallets` publishes its own `ready` for exactly this,
    and `ready` below is both. Without that conjunction every reload would flash
    "Connect" at someone already connected and drop the veil back over a console
    they had already unlocked.
  */
  const address = wallets[0]?.address ?? user?.wallet?.address;

  const value: Visitor = {
    configured: true,
    ready: privyReady && walletsReady,
    address,
    connect: connectWallet,
    /*
      Both, because neither alone covers every visitor this console now has.

      `logout` is documented as clearing *authentication* state, and a connected
      wallet is not authenticated — so on its own it is the counterpart to the
      flow this file no longer uses. It stays because a visitor who
      authenticated before this change still has a session to clear.

      Each wallet's own `disconnect` is the counterpart to `connectWallet`, and
      Privy is candid that it "will no-op" for clients without programmatic
      disconnects, naming MetaMask among them. That is not a reason to leave it
      out: it is the only thing addressed at a connect-only wallet at all, and a
      no-op costs nothing beside the `logout` that follows it. It is also marked
      experimental, which the conjunction absorbs — if it changes under us, what
      is left is exactly today's behaviour rather than a broken control.
    */
    disconnect: () => {
      for (const wallet of wallets) wallet.disconnect();
      void logout();
    },
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
