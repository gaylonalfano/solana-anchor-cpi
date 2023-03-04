use anchor_lang::prelude::*;
use anchor_spl::associated_token;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::state::DappTokenManager;

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
        constraint = dapp_token_manager.mint == mint.key(),
        seeds = [
            DappTokenManager::SEED_PREFIX.as_ref(),
            mint.key().as_ref(),
            dapp_token_manager.authority.as_ref(),
        ],
        bump = dapp_token_manager.bump,
    )]
    pub dapp_token_manager: Account<'info, DappTokenManager>,

    // Q: Need user as Signer if already has ATA?
    // A: Yes!
    #[account(mut)]
    pub user: Signer<'info>,

    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, associated_token::AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
