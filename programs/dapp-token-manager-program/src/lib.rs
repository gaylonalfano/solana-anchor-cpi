use anchor_lang::prelude::*;

use instructions::*;
use state::*;

pub mod instructions;
pub mod state;

// IMPORTANT: I want to build a DTMProgram that other programs
// can call via CPI. The CALLER can pass in details like the
// mint, mint_amount, etc. 

// QUESTIONS specific to using this via CPI:
// - Should the caller program also create a PDA or use Keypair to be 'authority'?
// - The caller will have cpi::context to this program, but NOT
//   the other way around, right?
// - 


declare_id!("CoZDizMLZU86SxPkLCky7uGbSoSMRVNUihAUoFBiQJhf");

#[program]
pub mod dapp_token_manager {
    use super::*;

    pub fn create_dapp_token_manager(
        ctx: Context<CreateDappTokenManager>, 
        caller_program: Pubkey,
        mint_amount: u64,
    ) -> Result<()> {
        instructions::create_dapp_token_manager::handler(ctx, caller_program, mint_amount)
    }

    pub fn mint_dapp_token_supply(ctx: Context<MintDappTokenSupply>) -> Result<()> {
        instructions::mint_dapp_token_supply::handler(ctx)
    }

}
