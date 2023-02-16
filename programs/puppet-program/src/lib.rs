// https://book.anchor-lang.com/anchor_in_depth/CPIs.html
use anchor_lang::prelude::*;

declare_id!("CEReZ1uhTPWpaY3YbScWvKeLm8XcM6jM42dkv8F9Dypk");

#[program]
pub mod puppet_program {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        ctx.accounts.puppet.authority = authority;
        Ok(())
    }

    pub fn set_data(ctx: Context<SetData>, data: u64) -> Result<()> {
        let puppet = &mut ctx.accounts.puppet;
        puppet.data = data;
        Ok(())
    }
    // Q: How to return values from handler functions?
    // A: Use Solana's set_return_data and get_return_data syscalls!
    // This data can be used in CPI callers and clients.
    // REF: https://book.anchor-lang.com/anchor_in_depth/CPIs.html#returning-values-from-handler-functions
    // You just need to specify the return data inside Result<u64>
    // When you don't use '()' return type, Anchor calls set_return_data()
    // The return from a CPI call is wrapped in a struct to allow lazy retrieval of data
    // pub fn set_data(ctx: Context<SetData>, data: u64) -> Result<u64> {
    //     let puppet = &mut ctx.accounts.puppet;
    //     puppet.data = data;
    //     Ok(data)
    // }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = user, space = Puppet::ACCOUNT_SPACE)]
    pub puppet: Account<'info, Puppet>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetData<'info> {
    // NOTE has_one checks that puppet.authority = authority.key()
    #[account(mut, has_one = authority)]
    pub puppet: Account<'info, Puppet>,
    // Q: If masterProgram uses a PDA for PullStrings 'authority' CPI account,
    // will type Signer still work?
    pub authority: Signer<'info>,
}

#[account]
pub struct Puppet {
    pub data: u64,
    pub authority: Pubkey,
}

const DISCRIMINATOR_LENGTH: usize = 8; 
const DATA_LENGTH: usize = 8;
const AUTHORITY_LENGTH: usize = 32;

impl Puppet {
    pub const ACCOUNT_SPACE: usize = DISCRIMINATOR_LENGTH + DATA_LENGTH + AUTHORITY_LENGTH;
}
