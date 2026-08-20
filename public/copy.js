// ===========================================================
// Click Miner — all user-facing text lives here.
//
// Edit any string below and reload the page in your browser to see the
// change — nothing needs to be rebuilt or restarted. This file is loaded
// directly by public/app.js (as a plain ES module import), which uses it
// to fill in every label, button, message, and paragraph in the app.
//
// A few entries are functions instead of plain strings — those build a
// message out of a live value (e.g. the current node's block height, or
// how many zero bits a hash landed). You can still edit the wording
// around the ${...} parts freely; just don't remove the ${...} itself,
// since that's where the live value gets inserted.
// ===========================================================

export const COPY = {
  meta: {
    pageTitle: "Click Miner :: The World's Least Efficient Bitcoin Miner",
  },

  marquee:
    "⛏ CLICK MINER ⛏ the world's least efficient bitcoin miner ⛏ manually mine real bitcoin, one hash at a time ⛏ you will (basically) never find a block, and that is the entire point ⛏ 100% free & open source ⛏ no pool, no telemetry, just you vs. 2^256 ⛏",

  banner: {
    title: "CLICK MINER",
    tagline: "the world's least efficient bitcoin miner",
  },

  status: {
    checking: "checking connection…",
    connected: (chain) => `connected · ${chain}`,
    nodeUnreachable: (errorMessage) => `node unreachable: ${errorMessage || 'unknown error'}`,
    checkFailed: (errorMessage) => `status check failed: ${errorMessage}`,
  },

  tabs: {
    mine: '⛏ MINE',
    settings: '⚙ SETTINGS',
    learn: '📖 LEARN',
  },

  mine: {
    hashesSubmitted: (n) => `Hashes submitted: ${n}`,
    mineButton: '⛏ MINE! ⛏',
    autoclickLabel: 'auto-click',

    targetBarLabel: 'Leading zero bits vs. target (closer = luckier)',
    targetBarCaption: (leadingZeroBits, targetLeadingZeroBits) => `${leadingZeroBits} / ${targetLeadingZeroBits} bits`,

    lastHashLabel: 'Last hash',
    lastHashPlaceholder: '--',

    hashrateWindowTitle: "Your share of the Bitcoin network's hash rate",
    hashrateSharePlaceholder: '--',
    hashrateShareCaption: (percentText) => percentText,

    successTitle: '🎉 YOU FOUND A BLOCK?! 🎉',
    successAccepted: (hash) => `submitblock accepted! hash: ${hash}`,
    successRejected: (detail) => `submitblock rejected: ${detail}`,
    successNoSubmit: '(no submit attempted)',

    headerWindowTitlePrefix: 'BLOCK_HEADER.DAT — candidate #',
    headerHexLabel: 'Full 80-byte header (hex)',
    headerHexPlaceholder: '--',

    fields: {
      version: {
        label: 'Version',
        help: 'Which consensus rules this block signals support for.',
      },
      prevHash: {
        label: 'Prev Block Hash',
        help: 'The hash of the block this one builds on — this is what chains blocks together.',
      },
      merkleRoot: {
        label: 'Merkle Root',
        help: 'A single hash committing to every transaction in this block, coinbase included.',
      },
      time: {
        label: 'Time',
        help: 'Unix timestamp claimed for this block.',
      },
      bits: {
        label: 'Bits (target)',
        help: 'Compact encoding of the target your hash must fall under to win.',
      },
      nonce: {
        label: 'Nonce',
        help: "The only field you're really turning the crank on. 4 bytes = ~4.3 billion values — edit it yourself, or let MINE! auto-increment it.",
      },
      coinbase: {
        label: 'Coinbase pays',
        help: 'Block subsidy + fees, sent to your configured payout address.',
      },
    },

    refreshButton: '↻ REFRESH TEMPLATE',
    refreshFetching: 'fetching fresh template…',
    refreshDone: '✓ refreshed',

    logWindowTitle: 'Recent attempts',
    logLine: (attempts, nonce, hashPrefix, leadingZeroBits) =>
      `#${attempts} nonce=${nonce} → ${hashPrefix}… (${leadingZeroBits} zero bits)`,
    logHitAccepted: '*** BLOCK ACCEPTED BY YOUR NODE ***',
    logHitRejected: '*** target met, but submission failed — see banner above ***',
    logError: (message) => `error: ${message}`,
  },

  settings: {
    windowTitle: 'SETTINGS.EXE — your node & payout address',
    intro:
      'Click Miner connects to <strong>your own</strong> Bitcoin full node — never a ' +
      'third-party pool. On the (nearly impossible) chance you find a block, the ' +
      'reward pays out to the address below. This app never sees or stores a ' +
      'private key.',

    rpcLegend: 'bitcoind RPC',
    hostLabel: 'Host',
    hostPlaceholder: '127.0.0.1',
    portLabel: 'Port',
    portPlaceholder: '8332',
    usernameLabel: 'RPC Username',
    passwordLabel: 'RPC Password',
    passwordPlaceholder: '(leave blank to keep current)',
    passwordUnchangedPlaceholder: '(unchanged)',
    cookiePathLabel: 'Cookie file path',
    cookiePathPlaceholder: '/home/user/.bitcoin/.cookie',

    payoutLegend: 'Payout address',
    payoutLabel: 'Your Bitcoin address',
    payoutPlaceholder: 'bc1q… / 1… / 3… / bc1p…',
    payoutHelp: 'Legacy, SegWit, and Taproot addresses are all supported.',

    saveButton: 'SAVE SETTINGS',
    saving: 'saving…',
    saved: '✓ saved',
    saveError: (message) => `✗ ${message}`,
  },

  // Each Learn tab section is one heading + one block of body HTML.
  // Basic inline tags (<strong>, <em>, <sup>, <var>, <code>) and a
  // <p class="math"> paragraph for standalone formulas are safe to use —
  // they already have styling defined in style.css.
  learn: {
    windowTitle: 'LEARN.TXT — how bitcoin mining actually works',
    sections: [
      {
        heading: 'What even is a "hash"?',
        html: `
          <p>
            SHA-256 is a function that takes any input — a word, a book, this
            webpage — and squishes it into a fixed-size 256-bit (32-byte)
            fingerprint. The same input always gives the same fingerprint.
            Change one letter anywhere in the input, and the fingerprint
            changes completely and unpredictably — there's no "getting
            warmer." You can't work backwards from a fingerprint to figure
            out the input either; your only real option is to guess inputs
            and check. Bitcoin actually hashes <em>twice</em> in a row
            (SHA-256(SHA-256(x)), called "SHA256d") mostly for a technical
            reason related to an old weakness in plain SHA-256 — and Click
            Miner does exactly the same thing, for real, on every click.
          </p>
        `,
      },
      {
        heading: "The 80 bytes you're actually hashing",
        html: `
          <p>
            Every Bitcoin block has a small "header" — just 80 bytes — and
            that's the only thing a miner is actually hashing, over and
            over. It's six fields:
          </p>
          <ul>
            <li><strong>Version</strong> — which consensus rules this block signals support for.</li>
            <li><strong>Previous block hash</strong> — the fingerprint of the block before this one. This is what chains every block into one unbroken history: change an old block, and every fingerprint after it changes too.</li>
            <li><strong>Merkle root</strong> — a single fingerprint representing every transaction in the block. Change one transaction, the merkle root changes, the header's hash changes.</li>
            <li><strong>Time</strong> — roughly when the block was made.</li>
            <li><strong>Bits</strong> — a compact way of writing down the "target" (see below).</li>
            <li><strong>Nonce</strong> — a 4-byte number with no meaning at all except "a knob to turn." This is the field a miner changes from one attempt to the next.</li>
          </ul>
        `,
      },
      {
        heading: 'The target: your finish line',
        html: `
          <p>
            The network agrees on a "target" — an enormous number, but still
            smaller than the biggest possible 256-bit number. To win, your
            header's hash — read as one giant number — has to land below
            that target. Hashes are essentially random: thanks to that
            avalanche effect, there's no way to nudge a hash lower on
            purpose. You can only change the input (usually the nonce) and
            get a completely fresh, unpredictable number back. Every attempt
            is an independent roll of a 256-bit die, and you win if you roll
            under the target.
          </p>
          <p>
            The lower the target, the harder it is — fewer possible hash
            outputs qualify. "Bits" is just a compact way of writing that
            huge target number down without transmitting all 32 bytes of it
            every time.
          </p>
        `,
      },
      {
        heading: 'The actual math: target, difficulty, and your odds',
        html: `
          <p>
            Every possible SHA256d output is a number somewhere between 0
            and a maximum value with 256 bits — call that max value
            <var>M</var> (<var>M</var> = 2<sup>256</sup> − 1). Your odds of
            any single hash landing under the current target are just
            division:
          </p>
          <p class="math">probability of winning, per hash = target ÷ M</p>
          <p>
            "Difficulty" is the number you'll actually see quoted everywhere
            — explorers, pools, this app — instead of the raw target, which
            is an unwieldy ~78-digit number. Difficulty is defined relative
            to the very first, easiest target Bitcoin ever used (block 0,
            bits = <code>0x1d00ffff</code>):
          </p>
          <p class="math">difficulty = target(easiest ever) ÷ target(right now)</p>
          <p>
            So a difficulty of, say, one trillion means today's target is
            one trillion times smaller — one trillion times harder to land
            under — than the very first block's target. Put those two
            together and you get the number that actually matters: how many
            hashes, on average, it takes to find one valid block.
          </p>
          <p class="math">expected hashes for one block ≈ difficulty × 2<sup>32</sup> (≈ 4.29 billion)</p>
          <p>
            That 2<sup>32</sup> falls out of how the original difficulty-1
            target lines up with the 256-bit hash space — the derivation
            doesn't matter, just the result. Worked example: at a difficulty
            of one trillion, that's roughly
            1,000,000,000,000 × 4,294,967,296 ≈ 4.3 × 10<sup>21</sup>
            expected hashes for the <em>entire network</em> to find one
            block. The "Bits" field on the Mine tab is live from your own
            node, so you can plug today's real number into this formula
            yourself any time.
          </p>
          <p>
            Whatever that number turns out to be, you personally contribute
            exactly one hash per click. The math doesn't care that you're
            clicking a button instead of running a warehouse of ASICs — it's
            the same lottery. You're just buying one ticket instead of a few
            trillion, which is roughly as close as "smaller than picking one
            specific grain of sand out of every beach on Earth, blindfolded,
            on the first try" gets to being an understatement.
          </p>
        `,
      },
      {
        heading: 'Difficulty adjustment: how the network keeps the pace',
        html: `
          <p>
            Bitcoin targets one new block roughly every 10 minutes — not
            because hashing takes 10 minutes, but because the target is
            deliberately tuned to make it take about that long, on average,
            for however much total hashing power happens to be pointed at
            the network right now. If a wave of new hardware comes online
            and blocks start arriving faster, the network needs to make the
            target harder to compensate — otherwise blocks would arrive
            faster and faster forever as hardware improves.
          </p>
          <p>
            So every 2016 blocks (roughly two weeks, if blocks are landing
            on schedule), every full node independently recalculates the
            target using one simple ratio:
          </p>
          <p class="math">new target = old target × (actual time for last 2016 blocks ÷ 20,160 minutes)</p>
          <p>
            Blocks came in faster than 2016 × 10 minutes? That ratio is
            less than 1, so the new target shrinks — mining gets harder.
            Blocks came in slower? The ratio is greater than 1, the target
            grows, mining gets easier. Either way, the adjustment is capped
            at 4× in either direction per retarget, so one wild two-week
            stretch can't send difficulty flying off the rails overnight.
          </p>
          <p>
            This is a fully automatic, no-committee-required feedback loop —
            every node computes the same new target from the same public
            block timestamps, so the whole network agrees on the new
            difficulty without anyone being in charge of it. It's also why
            the "Bits" field on the Mine tab changes over time even though
            you never touch it: it's whatever the network most recently
            agreed makes blocks land roughly every 10 minutes, live from
            your own node.
          </p>
        `,
      },
      {
        heading: 'Why bother with something this hard at all?',
        html: `
          <p>
            Because the difficulty <em>is</em> the security. Rewriting
            Bitcoin's history would mean redoing all of that brute-force
            work — for every block since — faster than the rest of the
            network combined is doing new work. That's not "hard," it's
            practically impossible. The "waste" of energy and guessing is
            exactly what makes the ledger expensive to rewrite and cheap to
            verify. That trade-off is the whole idea, and now you've done
            your own tiny, hopeless part of it.
          </p>
        `,
      },
    ],
  },

  footer: {
    githubLinkText: 'Click Miner on GitHub',
    // No link/logic yet — just the ask. Bitcoin Lightning donations are
    // planned as a follow-up.
    donationText: 'Enjoying Click Miner? Zaps are much appreciated!',
  },
};
