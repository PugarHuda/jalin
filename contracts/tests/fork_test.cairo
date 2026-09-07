//! The router against the real thing.
//!
//! Every other test in this suite runs against mocks, which prove the invariants
//! hold but cannot prove the router works with a contract nobody here wrote. A
//! mock ERC-4626 returns what the mock was told to return; Endur's vault returns
//! what Endur's vault returns, argument order and all.
//!
//! So this forks Starknet mainnet at a pinned block and runs a plan through the
//! deployed xSTRK vault, funded by the STRK20 pool's own STRK - which is exactly
//! where the STRK comes from in a real transaction.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, MessageToL1SpyTrait, declare,
    spy_messages_to_l1, start_cheat_caller_address, stop_cheat_caller_address,
};
use core::hash::HashStateTrait;
use core::poseidon::PoseidonTrait;
use starknet::account::Call;
use starknet::{ContractAddress, contract_address_const};
use jalin::interfaces::{
    IErc20Dispatcher, IErc20DispatcherTrait, IJalinRouterDispatcher, IJalinRouterDispatcherTrait,
};
use jalin::types::{Approval, OpenNoteDeposit, Output, Step};

/// The two ERC-20 entrypoints the router never calls itself, so they are not on
/// the production interface. The pool calls them, and this is where the test
/// stands in for the pool.
#[starknet::interface]
trait IErc20Pull<TState> {
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

/// One STRK, in base units.
const ONE: u128 = 1_000_000_000_000_000_000;

fn strk() -> ContractAddress {
    contract_address_const::<0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d>()
}

/// Endur's liquid staking vault. An ERC-4626 whose share token is itself, so the
/// output token and the target are the same address.
fn endur() -> ContractAddress {
    contract_address_const::<0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a>()
}

/// The STRK20 shielded pool. It holds millions of STRK and, in a real plan, is
/// the contract that hands the router its input before calling `privacy_invoke`.
fn pool() -> ContractAddress {
    contract_address_const::<0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a>()
}

fn treasury() -> ContractAddress {
    contract_address_const::<'TREASURY'>()
}

/// The real governor, not the mock - so this also proves the deployed pair works
/// together rather than only that each half works alone.
fn deploy_stack() -> ContractAddress {
    let gov_class = declare("JalinGovernor").unwrap().contract_class();
    let (governor, _) = gov_class
        .deploy(
            @array![
                pool().into(), // pool
                strk().into(), // ballot token
                treasury().into(), // fee recipient
                8, // max steps
                64, // max calldata
                100, // voting blocks
                10, // timelock blocks
                1, // quorum
            ],
        )
        .unwrap();

    let router_class = declare("JalinRouter").unwrap().contract_class();
    let (router, _) = router_class.deploy(@array![governor.into()]).unwrap();
    router
}

/// Moves STRK out of the pool the way the pool itself would.
fn fund(router: ContractAddress, amount: u128) {
    let token = IErc20Dispatcher { contract_address: strk() };
    start_cheat_caller_address(strk(), pool());
    token.transfer(router, amount.into());
    stop_cheat_caller_address(strk());
}

#[test]
#[fork("MAINNET")]
fn deposits_into_the_real_endur_vault() {
    let router = deploy_stack();
    fund(router, ONE);

    let steps = array![
        Step {
            target: endur(),
            selector: selector!("deposit"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            // deposit(assets: u256, receiver: ContractAddress). The order is the
            // ERC-4626 one, checked against the deployed vault rather than
            // assumed from the standard.
            calldata: array![ONE.into(), 0, router.into()],
        },
    ];

    // A floor well under par. One STRK cannot buy a whole share of a vault that
    // has been accruing staking rewards since launch, so this is loose on
    // purpose - the tight assertion is below, on what actually came back.
    let outputs = array![Output { token: endur(), note_id: 'NOTE', min_amount: ONE / 2 }];

    start_cheat_caller_address(router, pool());
    let credited = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), steps, outputs);

    assert(credited.len() == 1, 'one output, one note');
    let note = *credited.at(0);
    assert(note.token == endur(), 'credited in xSTRK');
    assert(note.note_id == 'NOTE', 'note id passed through');

    // xSTRK appreciates against STRK, so one STRK buys strictly fewer than one
    // share. A mock would have to be told this; the live vault simply is it.
    assert(note.amount > ONE / 2, 'more than the floor');
    assert(note.amount < ONE, 'a share is worth over par');
}

#[test]
#[fork("MAINNET")]
fn hands_the_real_shares_to_the_pool_and_keeps_nothing() {
    let router = deploy_stack();
    fund(router, ONE);

    let steps = array![
        Step {
            target: endur(),
            selector: selector!("deposit"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            calldata: array![ONE.into(), 0, router.into()],
        },
    ];
    let outputs = array![Output { token: endur(), note_id: 'NOTE', min_amount: 0 }];

    start_cheat_caller_address(router, pool());
    let credited = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), steps, outputs);
    let amount: u256 = (*credited.at(0)).amount.into();

    // I4 against a contract that was under no obligation to cooperate. The vault
    // takes the whole allowance, so no STRK is left - and if a future version of
    // it took less, this is the test that would say so.
    let strk_left = IErc20Dispatcher { contract_address: strk() }.balance_of(router);
    assert(strk_left == 0, 'no STRK left in the router');

    // The shares are still here, because crediting an output is an approval and
    // not a transfer. The pool collects them; the router only promises them.
    let shares = IErc20Dispatcher { contract_address: endur() };
    assert(shares.balance_of(router) == amount, 'shares held for the pool');

    let vault = IErc20PullDispatcher { contract_address: endur() };
    assert(vault.allowance(router, pool()) == amount, 'pool approved for exactly it');

    // Now do what the pool does next, and the router ends the transaction empty.
    start_cheat_caller_address(endur(), pool());
    vault.transfer_from(router, pool(), amount);
    stop_cheat_caller_address(endur());
    assert(shares.balance_of(router) == 0, 'router ends up holding none');
}

#[test]
#[fork("MAINNET")]
#[should_panic(expected: 'JALIN_BELOW_MIN_AMOUNT')]
fn the_floor_holds_against_a_real_price() {
    let router = deploy_stack();
    fund(router, ONE);

    let steps = array![
        Step {
            target: endur(),
            selector: selector!("deposit"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            calldata: array![ONE.into(), 0, router.into()],
        },
    ];

    // Demand a whole share for one STRK. The vault trades above par, so this is
    // a floor the real market cannot meet, and the plan has to revert rather
    // than credit less than was asked for.
    let outputs = array![Output { token: endur(), note_id: 'NOTE', min_amount: ONE }];

    start_cheat_caller_address(router, pool());
    IJalinRouterDispatcher { contract_address: router }.privacy_invoke(pool(), steps, outputs);
}

/// AVNU's exchange on mainnet. `multi_route_swap` was read from its class on
/// chain: sell_token, sell_amount: u256, buy_token, buy_amount: u256,
/// buy_token_min_amount: u256, beneficiary, integrator_fee_amount_bps,
/// integrator_fee_recipient, routes: Array<Route>.
fn avnu() -> ContractAddress {
    contract_address_const::<0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f>()
}

/// Native USDC - the one with 71 deposits in the pool, not the bridged one with 1.
fn usdc() -> ContractAddress {
    contract_address_const::<0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb>()
}

/// Ekubo's adapter inside AVNU, and the STRK/USDC pool it swaps through.
const EKUBO_ADAPTER: felt252 = 0x5dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b;

#[test]
#[fork("MAINNET")]
fn swaps_through_the_real_avnu_exchange() {
    let router = deploy_stack();
    fund(router, ONE);

    // The calldata AVNU's aggregator built for one STRK into native USDC with
    // the router as taker, on 28 August 2026, route and pool parameters
    // verbatim - only the beneficiary is this test's router rather than the
    // deployed one, and the minimum inside the call is left at one unit so that
    // it is the router's own floor below, and not AVNU's, that the test proves.
    // A mock DEX returns what the mock is told; this returns what Ekubo's pool
    // has in it at the forked block.
    let calldata = array![
        strk().into(), ONE.into(), 0, // sell_token, sell_amount: u256
        usdc().into(), 0x64f2, 0, // buy_token, buy_amount: u256 (AVNU's own estimate)
        1, 0, // buy_token_min_amount: u256 - one unit; the floor is the Output's
        router.into(), 0, 0, // beneficiary, integrator fee bps, integrator fee recipient
        1, // routes.len
        strk().into(), usdc().into(), EKUBO_ADAPTER, 0xe8d4a51000, // route: sell, buy, adapter, 100%
        6, // additional_swap_params.len: the Ekubo pool key and a price limit
        usdc().into(), strk().into(), 0x20c49ba5e353f80000000000000000, 0x3e8, 0,
        0x20e01af4964000000000000000000000,
    ];

    let steps = array![
        Step {
            target: avnu(),
            selector: selector!("multi_route_swap"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            calldata,
        },
    ];

    // A floor in USDC's six decimals: 0.01 USDC for one STRK. STRK traded near
    // $0.026 when this was written and the pool is deep enough that a one-STRK
    // swap barely moves it, so this is loose on purpose; the tight assertion is
    // on what came back.
    let outputs = array![Output { token: usdc(), note_id: 'NOTE', min_amount: 10_000 }];

    start_cheat_caller_address(router, pool());
    let credited = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), steps, outputs);
    stop_cheat_caller_address(router);

    assert(credited.len() == 1, 'one output, one note');
    let note = *credited.at(0);
    assert(note.token == usdc(), 'credited in USDC');
    assert(note.amount > 10_000, 'more than the floor');
    // Under one dollar. One STRK is not worth a dollar and a swap that returns
    // more than the input was worth is a broken pool, not a good price - which
    // is exactly what the bridged USDC.e pool quoted, and why it is not here.
    assert(note.amount < 1_000_000, 'under a dollar of USDC');

    // What the pool does next: pull by allowance. Then the router holds nothing.
    let out = IErc20PullDispatcher { contract_address: usdc() };
    assert(out.allowance(router, pool()) == note.amount.into(), 'pool may pull exactly the note');
    start_cheat_caller_address(usdc(), pool());
    out.transfer_from(router, pool(), note.amount.into());
    stop_cheat_caller_address(usdc());
    let balance = IErc20Dispatcher { contract_address: usdc() };
    assert(balance.balance_of(router) == 0, 'router ends up holding none');
    let strk_balance = IErc20Dispatcher { contract_address: strk() };
    assert(strk_balance.balance_of(router) == 0, 'no STRK left behind either');
}

/// Two protocols, one invoke - the claim this project is built on, run rather
/// than argued.
///
/// Everything above proves one call into one venue. That is not the argument.
/// The argument is that a swap and a deposit are the same object to this
/// router, so a plan can carry both and the pool never learns it was two
/// things. Until this test the README said as much and conceded that lending
/// beside a swap "has not been run, on mainnet or on a fork" - a shape rather
/// than a result.
///
/// This runs it: one STRK through AVNU into native USDC, one STRK into Endur's
/// vault, two outputs credited into two notes, inside a single
/// `privacy_invoke`. Both venues are the deployed ones at the pinned block, so
/// the amounts are whatever Ekubo's pool and Endur's share price actually were.
#[test]
#[fork("MAINNET")]
fn a_swap_and_a_stake_in_the_same_invoke() {
    let router = deploy_stack();
    fund(router, ONE * 2);

    // The same AVNU calldata the single-venue test uses, with this test's
    // router as beneficiary. Copied deliberately rather than factored out: a
    // helper that built it would be a second place for the route to drift from
    // what the aggregator actually returned.
    let swap = array![
        strk().into(), ONE.into(), 0,
        usdc().into(), 0x64f2, 0,
        1, 0,
        router.into(), 0, 0,
        1,
        strk().into(), usdc().into(), EKUBO_ADAPTER, 0xe8d4a51000,
        6,
        usdc().into(), strk().into(), 0x20c49ba5e353f80000000000000000, 0x3e8, 0,
        0x20e01af4964000000000000000000000,
    ];

    let steps = array![
        Step {
            target: avnu(),
            selector: selector!("multi_route_swap"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            calldata: swap,
        },
        Step {
            target: endur(),
            selector: selector!("deposit"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            calldata: array![ONE.into(), 0, router.into()],
        },
    ];

    // One floor per output, each in its own token's decimals. Both loose for
    // the same reason as above; the tight assertions are on what came back.
    let outputs = array![
        Output { token: usdc(), note_id: 'USDC', min_amount: 10_000 },
        Output { token: endur(), note_id: 'XSTRK', min_amount: ONE / 2 },
    ];

    start_cheat_caller_address(router, pool());
    let credited = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), steps, outputs);
    stop_cheat_caller_address(router);

    assert(credited.len() == 2, 'two venues, two notes');

    let bought = *credited.at(0);
    assert(bought.token == usdc(), 'first note is the swap');
    assert(bought.amount > 10_000, 'swap cleared its floor');
    assert(bought.amount < 1_000_000, 'under a dollar of USDC');

    let staked = *credited.at(1);
    assert(staked.token == endur(), 'second note is the stake');
    assert(staked.amount > ONE / 2, 'stake cleared its floor');
    assert(staked.amount < ONE, 'a share is worth over par');

    // I4 across two tokens at once: the router ends holding neither, and the
    // pool may pull exactly what it was told about and no more.
    let usdc_token = IErc20PullDispatcher { contract_address: usdc() };
    let xstrk_token = IErc20PullDispatcher { contract_address: endur() };
    assert(usdc_token.allowance(router, pool()) == bought.amount.into(), 'usdc allowance is exact');
    assert(xstrk_token.allowance(router, pool()) == staked.amount.into(), 'xstrk allowance is exact');

    start_cheat_caller_address(usdc(), pool());
    usdc_token.transfer_from(router, pool(), bought.amount.into());
    stop_cheat_caller_address(usdc());
    start_cheat_caller_address(endur(), pool());
    xstrk_token.transfer_from(router, pool(), staked.amount.into());
    stop_cheat_caller_address(endur());

    let strk_left = IErc20Dispatcher { contract_address: strk() };
    let usdc_left = IErc20Dispatcher { contract_address: usdc() };
    let xstrk_left = IErc20Dispatcher { contract_address: endur() };
    assert(strk_left.balance_of(router) == 0, 'no STRK left behind');
    assert(usdc_left.balance_of(router) == 0, 'no USDC left behind');
    assert(xstrk_left.balance_of(router) == 0, 'no xSTRK left behind');
}

/// Vesu's STRK lending market, as an ERC-4626 vault.
///
/// Read from Vesu's own market list and checked on chain rather than taken from
/// a blog post: `asset()` on this address returns STRK, and `deposit` takes
/// `(assets: u256, receiver: ContractAddress)` — the same shape Endur uses, so
/// the router needs nothing new to reach it.
///
/// The Prime pool's vToken. Vesu V2 pools themselves take positions through
/// `modify_position` with a struct this router would have to encode by hand;
/// the vToken is the ERC-4626 face of the same market and is what a lender
/// actually holds.
fn vesu_strk() -> ContractAddress {
    contract_address_const::<0x06d6d2bf905dd199c78f2e421521d8473042737be9f47904e7578536c10f279d>()
}

/// Lending, which this project has argued and never run.
///
/// The README conceded it for three weeks: lending and bridging "are the same
/// object in the router's eyes and neither has been run, on mainnet or on a
/// fork". That sentence was the honest version of an untested claim, and this
/// test is what replaces it for the first half. One STRK into Vesu's live STRK
/// market at the pinned block, credited back as vToken shares into a note.
///
/// Nothing about the router changed to make this work, which is the finding.
/// The plan is the Endur plan with a different address in it.
#[test]
#[fork("MAINNET")]
fn lends_into_the_real_vesu_market() {
    let router = deploy_stack();
    fund(router, ONE);

    let steps = array![
        Step {
            target: vesu_strk(),
            selector: selector!("deposit"),
            approvals: array![Approval { token: strk(), amount: ONE }],
            calldata: array![ONE.into(), 0, router.into()],
        },
    ];

    // Loose on purpose. A lending vault's share price drifts with interest
    // accrued since it opened, so the floor is a sanity bound and the tight
    // assertions are below, on what the market actually paid.
    let outputs = array![Output { token: vesu_strk(), note_id: 'VSTRK', min_amount: ONE / 4 }];

    start_cheat_caller_address(router, pool());
    let credited = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), steps, outputs);
    stop_cheat_caller_address(router);

    assert(credited.len() == 1, 'one output, one note');
    let note = *credited.at(0);
    assert(note.token == vesu_strk(), 'credited in vSTRK');
    assert(note.amount > ONE / 4, 'more than the floor');
    // A share of a market that has been lending since it opened is worth more
    // than one unit of the asset, so a STRK buys fewer than one share. A mock
    // would have to be told that; the live market simply is it.
    assert(note.amount < ONE, 'a share is worth over par');

    // And I4: the pool may pull exactly the note, after which the router holds
    // neither the shares nor any of the STRK it was funded with.
    let shares = IErc20PullDispatcher { contract_address: vesu_strk() };
    assert(shares.allowance(router, pool()) == note.amount.into(), 'pool may pull exactly');
    start_cheat_caller_address(vesu_strk(), pool());
    shares.transfer_from(router, pool(), note.amount.into());
    stop_cheat_caller_address(vesu_strk());

    let left = IErc20Dispatcher { contract_address: vesu_strk() };
    let strk_left = IErc20Dispatcher { contract_address: strk() };
    assert(left.balance_of(router) == 0, 'no shares left behind');
    assert(strk_left.balance_of(router) == 0, 'no STRK left behind');
}

/// Mainnet ETH, which the pool holds and StarkGate burns.
fn eth() -> ContractAddress {
    contract_address_const::<0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7>()
}

/// StarkGate's ETH bridge on L2. `initiate_withdraw(l1_recipient, amount)` was
/// read from its class at the pinned block; it burns the caller's ETH through
/// the token's `permissioned_burn` and posts a message to L1, so there is no
/// approval to grant and nothing comes back.
fn starkgate_eth() -> ContractAddress {
    contract_address_const::<0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82>()
}

/// Moves ETH out of the pool the way the pool itself would.
fn fund_eth(router: ContractAddress, amount: u128) {
    let token = IErc20Dispatcher { contract_address: eth() };
    start_cheat_caller_address(eth(), pool());
    token.transfer(router, amount.into());
    stop_cheat_caller_address(eth());
}

/// Bridging, the last thing this project argued and had not run.
///
/// A bridge leg is the shape every other plan is not: value leaves for good and
/// nothing is credited back, so the plan declares no outputs and the pool
/// accepts an empty span. `router_test` proves that against a mock. This runs
/// it against StarkGate: a thousandth of an ETH out of the router, through the
/// real L2 bridge, into a message bound for L1 - with the router ending at
/// zero, because the bridge burned what it was handed rather than holding it.
///
/// The recipient is an L1 address that is not ours and the amount is small on
/// purpose: on a fork nothing leaves, and the point is the shape of the call,
/// not the destination of the money.
#[test]
#[fork("MAINNET")]
fn bridges_out_through_the_real_starkgate() {
    let router = deploy_stack();
    let amount: u128 = 1_000_000_000_000_000; // 0.001 ETH
    fund_eth(router, amount);

    // Any L1 address will do on a fork. This one is StarkGate's own L1 ETH
    // bridge, which is at least a place ETH has been sent before.
    let l1_recipient: felt252 = 0xae0ee0a63a2ce6baeeffe56e7714fb4efe48d419;

    let steps = array![
        Step {
            target: starkgate_eth(),
            selector: selector!("initiate_withdraw"),
            // No approval: the bridge burns the caller's balance through
            // `permissioned_burn` rather than pulling by allowance.
            approvals: array![],
            calldata: array![l1_recipient, amount.into(), 0],
        },
    ];
    // Value leaves for good. Nothing to credit, so nothing to declare.
    let outputs: Array<Output> = array![];

    let mut spy = spy_messages_to_l1();

    start_cheat_caller_address(router, pool());
    let credited = IJalinRouterDispatcher { contract_address: router }
        .privacy_invoke(pool(), steps, outputs);
    stop_cheat_caller_address(router);

    assert(credited.len() == 0, 'a bridge credits nothing back');

    // The bridge said so to L1: one message, from the bridge, carrying the
    // recipient and the amount. The rest of the payload is StarkGate's own
    // framing and not this test's to pin.
    // `get_messages()` returns a struct around the array, not the array.
    let messages = spy.get_messages().messages;
    let mut found = false;
    let mut i = 0;
    while i < messages.len() {
        let (from, message) = messages.at(i);
        if *from == starkgate_eth() {
            let payload = message.payload;
            let mut has_recipient = false;
            let mut has_amount = false;
            let mut j = 0;
            while j < payload.len() {
                if *payload.at(j) == l1_recipient { has_recipient = true; }
                if *payload.at(j) == amount.into() { has_amount = true; }
                j += 1;
            }
            if has_recipient && has_amount { found = true; }
        }
        i += 1;
    }
    assert(found, 'starkgate messaged L1');

    // I4 for a token that left: the router ends holding none of the ETH it
    // was funded with, and there is no allowance because there was no approval.
    let balance = IErc20Dispatcher { contract_address: eth() };
    assert(balance.balance_of(router) == 0, 'no ETH left behind');
}

// ---------------------------------------------------------------------------
// Shadow accounts: the case the router cannot serve, on the real anonymizer
// ---------------------------------------------------------------------------

/// The deployed shadow-account anonymizer. `app/lib/config.ts` carries the same
/// address and `/api/params` checks which pool it is bound to on every load.
fn shadow_anonymizer() -> ContractAddress {
    contract_address_const::<0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7>()
}

/// One shadow account, as `get_shadow_accounts` describes it: the nonce, the
/// address it has or would deploy to, and whether it is there yet.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
struct ShadowAccountInfo {
    nonce: u64,
    address: ContractAddress,
    is_deployed: bool,
}

/// How much of a token the anonymizer collects from the shadow account once
/// the calls have run. `Diff` is the one a persistent position wants.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
enum CollectPolicy {
    All,
    Diff,
    Exact: u128,
}

/// An open note to settle from the shadow account after the calls.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
struct OpenNote {
    note_id: felt252,
    token: ContractAddress,
    collect_policy: CollectPolicy,
}

/// The anonymizer's interface, spelled here so the test binds to the deployed
/// contract's ABI rather than to a crate that is not a dependency of this one.
///
/// And the two differ, which is why this is spelled rather than imported: the
/// vendored source returns `(deposits, addresses)` so the pool can screen the
/// shadow account the funds came through, and the class deployed at the pinned
/// block - read with `starknet_getClass` - returns the deposits alone. A
/// dispatcher built from the source fails on the chain with 'Returned data too
/// short'. The address is still knowable from `get_shadow_account`, so the
/// test asks for it that way.
#[starknet::interface]
trait IShadowAccountAnonymizer<TState> {
    fn privacy_invoke_with_computation(
        ref self: TState,
        identity_commitment: felt252,
        calls: Array<Call>,
        open_notes: Span<OpenNote>,
    ) -> Span<OpenNoteDeposit>;
    fn get_shadow_accounts(
        self: @TState,
        partial_commitment: felt252,
        start_nonce: u64,
        end_nonce: u64,
        until_undeployed: bool,
    ) -> Span<ShadowAccountInfo>;
    fn get_shadow_account(self: @TState, identity_commitment: felt252) -> ContractAddress;
    fn get_privacy_contract(self: @TState) -> ContractAddress;
}

/// `hash(hash(identity_key, dapp_name), nonce)`, as the anonymizer derives it.
/// The identity key is what the pool computes from the user's private key; the
/// test stands in for the pool here too, so any felt will do as long as the
/// same one is used twice.
fn shadow_commitment(
    identity_key: felt252, dapp_name: felt252, nonce: felt252,
) -> (felt252, felt252) {
    let partial = PoseidonTrait::new().update(identity_key).update(dapp_name).finalize();
    let commitment = PoseidonTrait::new().update(partial).update(nonce).finalize();
    (partial, commitment)
}

/// A position the router cannot hold, held by a shadow account instead.
///
/// Invariant I4 says the router ends every transaction empty, which is why it
/// is safe to hand it arbitrary calldata - and why it can never keep a lending
/// position open across two transactions. STRK20 has a second anonymizer for
/// exactly that: a shadow account, a real Starknet account the pool derives
/// per identity, which holds what the router may not.
///
/// This runs that on the deployed anonymizer at the pinned block. The first
/// interaction opens a Vesu position from a shadow account that does not exist
/// yet, and collects nothing; the position stays. The second, from the same
/// identity, closes it and collects the difference into a note. The address is
/// the one the anonymizer predicted before anything was deployed, because the
/// pool has to know where to send the input before the account exists.
///
/// Together with `lends_into_the_real_vesu_market` this is the whole argument
/// of the project in two tests: the same Vesu deposit, once as a stateless plan
/// through the router and once as a position on a shadow account, and the
/// choice between them is the shape of the interaction rather than the
/// presence of a helper contract.
#[test]
#[fork("MAINNET")]
fn a_position_the_router_cannot_hold_lives_on_a_shadow_account() {
    let anonymizer = IShadowAccountAnonymizerDispatcher { contract_address: shadow_anonymizer() };
    assert(anonymizer.get_privacy_contract() == pool(), 'bound to the same pool');

    let (partial, commitment) = shadow_commitment('JALIN_IDENTITY', 'jalin', 0);

    // Before anything: no account, but an address. The pool sends the input
    // there, so it has to be knowable first.
    let predicted = anonymizer.get_shadow_accounts(partial, 0, 1, false);
    assert(predicted.len() == 1, 'one nonce, one entry');
    let shadow = *predicted.at(0).address;
    assert(!*predicted.at(0).is_deployed, 'not deployed yet');
    let none: felt252 = anonymizer.get_shadow_account(commitment).into();
    assert(none == 0, 'no account recorded');

    // The pool hands the shadow account its input, as it does the router.
    let token = IErc20Dispatcher { contract_address: strk() };
    start_cheat_caller_address(strk(), pool());
    token.transfer(shadow, ONE.into());
    stop_cheat_caller_address(strk());

    // First interaction: open the position. Two calls, because a shadow
    // account is an account and grants its own allowances; there is no
    // `approvals` field to declare them in. Nothing is collected, so the
    // shares stay where the router could never leave them.
    let open = array![
        Call {
            to: strk(),
            selector: selector!("approve"),
            calldata: array![vesu_strk().into(), ONE.into(), 0].span(),
        },
        Call {
            to: vesu_strk(),
            selector: selector!("deposit"),
            calldata: array![ONE.into(), 0, shadow.into()].span(),
        },
    ];
    start_cheat_caller_address(shadow_anonymizer(), pool());
    let deposits = anonymizer.privacy_invoke_with_computation(commitment, open, array![].span());
    stop_cheat_caller_address(shadow_anonymizer());

    assert(deposits.len() == 0, 'nothing collected yet');
    assert(anonymizer.get_shadow_account(commitment) == shadow, 'deployed where predicted');
    let after = anonymizer.get_shadow_accounts(partial, 0, 1, true);
    assert(after.len() == 1 && *after.at(0).is_deployed, 'now deployed');

    let shares = IErc20Dispatcher { contract_address: vesu_strk() };
    let held = shares.balance_of(shadow);
    assert(held > 0, 'the position is open');
    assert(token.balance_of(shadow) == 0, 'all of it went in');

    // Second interaction, same identity, a transaction later: close the
    // position and collect only what this interaction gained. Same address,
    // no redeploy - the account remembered the shares between the two.
    let close = array![
        Call {
            to: vesu_strk(),
            selector: selector!("redeem"),
            calldata: array![held.low.into(), held.high.into(), shadow.into(), shadow.into()]
                .span(),
        },
    ];
    let notes = array![
        OpenNote { note_id: 'BACK', token: strk(), collect_policy: CollectPolicy::Diff },
    ];
    start_cheat_caller_address(shadow_anonymizer(), pool());
    let deposits = anonymizer.privacy_invoke_with_computation(commitment, close, notes.span());
    stop_cheat_caller_address(shadow_anonymizer());

    assert(deposits.len() == 1, 'one note settled');
    let back = *deposits.at(0);
    assert(back.note_id == 'BACK', 'note id passed through');
    assert(back.token == strk(), 'collected in STRK');
    // Same block, so no interest; ERC-4626 rounding may keep a wei. The point
    // is that the whole principal came back through a note, not the wei.
    assert(back.amount <= ONE, 'no more than went in');
    assert(back.amount > ONE - ONE / 1000, 'the principal came back');
    // The anonymizer holds the collected STRK and the pool may pull exactly it,
    // the same handshake the router ends on.
    let pull = IErc20PullDispatcher { contract_address: strk() };
    assert(
        pull.allowance(shadow_anonymizer(), pool()) == back.amount.into(), 'pool may pull exactly',
    );
    assert(token.balance_of(shadow) == 0, 'shadow account emptied');
    assert(shares.balance_of(shadow) == 0, 'position closed');
}
