//! Test doubles. Compiled into the package so snforge can declare them; nothing
//! here is deployed to a live network.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockErc20<TState> {
    fn mint(ref self: TState, to: ContractAddress, amount: u256);
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

/// A target that pulls `pull_bps` of what it was offered and pays back at
/// `rate_bps`. Pulling less than offered is how the residue and stale-allowance
/// tests are driven.
#[starknet::interface]
pub trait IMockSwap<TState> {
    fn swap(ref self: TState, in_token: ContractAddress, in_amount: u256);
}

/// A target that turns on the router while the router is calling it.
///
/// The reentrancy latch is a security claim, and a claim with no adversary
/// against it is a comment. This is the adversary: it is a legitimate step
/// target, and the first thing it does with control is try to use it.
#[starknet::interface]
pub trait IMockAttacker<TState> {
    /// `mode`: 0 calls `sweep`, 1 calls `privacy_invoke` again.
    fn attack(ref self: TState, mode: u8, token: ContractAddress);
}

#[starknet::interface]
pub trait IMockGovernor<TState> {
    fn set_paused(ref self: TState, paused: bool);
    fn set_denied(ref self: TState, target: ContractAddress, denied: bool);
    fn set_fee(ref self: TState, fee_bps: u16, recipient: ContractAddress);
    fn set_limits(ref self: TState, max_steps: u32, max_calldata: u32);
}

#[starknet::contract]
pub mod MockErc20 {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    impl MockErc20Impl of super::IMockErc20<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let from = get_caller_address();
            let balance = self.balances.read(from);
            assert(balance >= amount, 'MOCK_INSUFFICIENT_BALANCE');
            self.balances.write(from, balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let allowed = self.allowances.read((sender, spender));
            assert(allowed >= amount, 'MOCK_INSUFFICIENT_ALLOWANCE');
            let balance = self.balances.read(sender);
            assert(balance >= amount, 'MOCK_INSUFFICIENT_BALANCE');
            self.allowances.write((sender, spender), allowed - amount);
            self.balances.write(sender, balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
    }
}

#[starknet::contract]
pub mod MockSwap {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};

    #[storage]
    struct Storage {
        out_token: ContractAddress,
        rate_bps: u256,
        pull_bps: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, out_token: ContractAddress, rate_bps: u256, pull_bps: u256,
    ) {
        self.out_token.write(out_token);
        self.rate_bps.write(rate_bps);
        self.pull_bps.write(pull_bps);
    }

    #[abi(embed_v0)]
    impl MockSwapImpl of super::IMockSwap<ContractState> {
        fn swap(ref self: ContractState, in_token: ContractAddress, in_amount: u256) {
            let caller = get_caller_address();
            let pulled = in_amount * self.pull_bps.read() / 10000;
            IMockErc20Dispatcher { contract_address: in_token }
                .transfer_from(caller, get_contract_address(), pulled);
            let out = pulled * self.rate_bps.read() / 10000;
            IMockErc20Dispatcher { contract_address: self.out_token.read() }
                .transfer(caller, out);
        }
    }
}

#[starknet::contract]
pub mod MockAttacker {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::call_contract_syscall;
    use starknet::{ContractAddress, SyscallResultTrait, get_caller_address};

    #[storage]
    struct Storage {
        pool: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl MockAttackerImpl of super::IMockAttacker<ContractState> {
        fn attack(ref self: ContractState, mode: u8, token: ContractAddress) {
            // The caller is the router, mid-sandwich, holding the user's funds.
            let router = get_caller_address();

            if mode == 0 {
                // Drain what is in flight to the fee recipient. The latch is the
                // only thing standing between a hostile target and this.
                call_contract_syscall(router, selector!("sweep"), array![token.into()].span())
                    .unwrap_syscall();
            } else {
                // Start a second sandwich from inside the first.
                call_contract_syscall(
                    router,
                    selector!("privacy_invoke"),
                    array![self.pool.read().into(), 0, 0].span(),
                )
                    .unwrap_syscall();
            }
        }
    }
}

/// Stands in for JalinGovernor so router tests can move a parameter without
/// running a proposal, a vote and a timelock first.
#[starknet::contract]
pub mod MockGovernor {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::ContractAddress;
    use jalin::interfaces::IJalinGovernor;
    use jalin::types::RouterParams;

    #[storage]
    struct Storage {
        params: RouterParams,
        denied: Map<ContractAddress, bool>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, fee_recipient: ContractAddress) {
        self
            .params
            .write(
                RouterParams {
                    paused: false,
                    max_steps: 8,
                    max_calldata: 64,
                    fee_bps: 0,
                    fee_recipient,
                },
            );
    }

    #[abi(embed_v0)]
    impl GovernorImpl of IJalinGovernor<ContractState> {
        fn params(self: @ContractState) -> RouterParams {
            self.params.read()
        }
        fn is_denied(self: @ContractState, target: ContractAddress) -> bool {
            self.denied.read(target)
        }
        fn label_of(self: @ContractState, target: ContractAddress) -> felt252 {
            0
        }
    }

    #[abi(embed_v0)]
    impl MockGovernorImpl of super::IMockGovernor<ContractState> {
        fn set_paused(ref self: ContractState, paused: bool) {
            self.params.write(RouterParams { paused, ..self.params.read() });
        }
        fn set_denied(ref self: ContractState, target: ContractAddress, denied: bool) {
            self.denied.write(target, denied);
        }
        fn set_fee(ref self: ContractState, fee_bps: u16, recipient: ContractAddress) {
            self
                .params
                .write(
                    RouterParams { fee_bps, fee_recipient: recipient, ..self.params.read() },
                );
        }
        fn set_limits(ref self: ContractState, max_steps: u32, max_calldata: u32) {
            self.params.write(RouterParams { max_steps, max_calldata, ..self.params.read() });
        }
    }
}
