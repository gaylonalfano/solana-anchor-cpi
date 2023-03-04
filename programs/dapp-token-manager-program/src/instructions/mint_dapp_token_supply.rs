use anchor_lang::prelude::*;
use anchor_spl::associated_token;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::state::DappTokenManager;

// Q: Where does Caller 'authority' fit into the equation? 
// Perhaps the Caller has 'authority' over the DTM, 
// and DTM has 'authority' over the Mint?
// U: Not sure if I need to include 'authority: Signer' in
// this instruction, since this is purely for MintTo, which
// DTM PDA has the authority to sign. Gotta test it out.

pub fn handler(ctx: Context<MintDappTokenSupply>) -> Result<()> {
    // 1. Program: Create ATA for the user wallet
    //    NOTE: Will need 'init_if_needed' feature
    // Q: Do I need to do anything in this handler or is all taken care of
    // because of init_if_needed?
    // A: Nope! init_if_needed handles it all!

    // 2. Program: Use MintTo IX to mint new supply to ATA
    //    NOTE: 'mint' account MUST be mutable
    //    NOTE: Signed/authorized by DTM PDA (CpiContext::new_with_signer())
    msg!("1. Minting supply to user token account (signing via dapp_token_manager PDA)...");
    token::mint_to(
        CpiContext::new_with_signer(
            // Program involved
            ctx.accounts.token_program.to_account_info(),
            // IX accounts
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.dapp_token_manager.to_account_info(),
            },
            // Signer Seeds
            &[&[
                DappTokenManager::SEED_PREFIX.as_bytes(),
                ctx.accounts.mint.key().as_ref(),
                ctx.accounts
                    .dapp_token_manager
                    .authority
                    .key()
                    .as_ref(),
                &[ctx.accounts.dapp_token_manager.bump]
            ]],
        ),
        ctx.accounts.dapp_token_manager.supply_amount_per_mint, // amount to mint each time
    )?;

    // Update DTM state
    ctx.accounts.dapp_token_manager.total_mint_count += 1;

    Ok(())
}

// ------- Accounts Validation Struct ------
#[derive(Accounts)]
pub struct MintDappTokenSupply<'info> {
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    // IMPORTANT: mint account MUST be mutable
    #[account(
        mut,
        constraint = mint.key() == dapp_token_manager.mint
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        // Q: Need has_one = authority? The Puppet Program
        // does have 'authority: Signer' account, but my DTM
        // is already set as Mint's mint_authority and freeze
        // authority, so not sure where Caller Program 'authority'
        // fits into the equation? Perhaps the Caller has
        // 'authority' over the DTM, and DTM has 'authority' over
        // the Mint?
        // U: Adding 'authority' account to this struct for now
        // and adding this has_one check, similar to Puppet
        // U: Removing has_one = authority. Just don't think I need it,
        // since this is a MintTo, which just needs DTM to sign
        // has_one = authority,
        constraint = dapp_token_manager.mint == mint.key(),
        seeds = [
            DappTokenManager::SEED_PREFIX.as_ref(),
            mint.key().as_ref(),
            dapp_token_manager.authority.as_ref(),
        ],
        bump = dapp_token_manager.bump,
    )]
    pub dapp_token_manager: Account<'info, DappTokenManager>,

    // NOTE This is whatever the Caller Program passed as 
    // IX data to the create_dapp_token_manager() method.
    // Could be PDA or Keypair.
    // Q: If PDA, do I need 'authority_bump'?
    // Q: Does this need to be Signer? Or something else?
    // Do I even need this?
    // U: Don't think I need this tbh. We'll see.
    // #[account(mut)]
    // pub authority: Signer<'info>,

    // Q: Need user as Signer if already has ATA?
    // A: Yes!
    #[account(mut)]
    pub user: Signer<'info>,

    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, associated_token::AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
