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
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ContractAddress, contract_address_const};
use jalin::interfaces::{
    IErc20Dispatcher, IErc20DispatcherTrait, IJalinRouterDispatcher, IJalinRouterDispatcherTrait,
};
use jalin::types::{Approval, Output, Step};

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
