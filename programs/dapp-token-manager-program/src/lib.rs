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


declare_id!("9T7y6YzHKFfHjpueENveMTidXcLmME1DK6TEjqQ753jc");

#[program]
pub mod dapp_token_manager_program {
    use super::*;

    pub fn create_dapp_token_manager(
        ctx: Context<CreateDappTokenManager>, 
        authority: Pubkey,
        supply_amount_per_mint: u64,
    ) -> Result<()> {
        instructions::create_dapp_token_manager::handler(ctx, authority, supply_amount_per_mint)
    }

    pub fn mint_dapp_token_supply(ctx: Context<MintDappTokenSupply>) -> Result<()> {
        instructions::mint_dapp_token_supply::handler(ctx)
    }

}
