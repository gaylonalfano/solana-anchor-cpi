use anchor_lang::{prelude::*, system_program};
use anchor_spl::token::{self, Token};

use crate::state::DappTokenManager;

// IMPORTANT: PDAs can only sign inside program context!
// -------- Instruction Function --------
pub fn handler(
    ctx: Context<CreateDappTokenManager>,
    caller_program: Pubkey,
    supply_amount_per_mint: u64,
) -> Result<()> {
    // 1. CLI/Client: Create a Keypair
    // 2. Program: Create a System Account using Keypair.publicKey
    msg!("1. Creating system account to store the actual mint (token)...");
    system_program::create_account(
        CpiContext::new(
            // Program involved
            ctx.accounts.system_program.to_account_info(),
            // IX accounts
            system_program::CreateAccount {
                from: ctx.accounts.authority.to_account_info(), // wallet
                to: ctx.accounts.mint.to_account_info(),
            },
        ),
        10000000,                          // lamports
        82,                                // size
        &ctx.accounts.token_program.key(), // owner - TOken Program
    )?;

    // 3. Program: Create the DTM PDA
    msg!("2. Create DappTokenManager PDA using calling program.key() & mint.key() as seeds...");
    let dapp_token_manager = DappTokenManager::new(
        caller_program,
        ctx.accounts.mint.key(),
        supply_amount_per_mint,
        // Q: What's going to be the authority? The caller program?
        // Or, a PDA of the caller program? A wallet?
        ctx.accounts.authority.key(),
        // NOTE bumps.get("account_name"), NOT seed!
        *ctx.bumps
            .get("dapp_token_manager")
            .expect("Bump not found."),
    );
    msg!("DappTokenManager: {:?}", &dapp_token_manager);

    // Need to update the inner Context state of DTM
    ctx.accounts
        .dapp_token_manager
        .set_inner(dapp_token_manager.clone());

    // 4. Program: Initialize the Mint - SPL Token Program
    //      - 4.1 - Set mint authority to DTM PDA
    //      - 4.2 - Set freeze authority to DTM PDA
    msg!("3. Initializing mint account and set authority to dapp_token_manager...");
    token::initialize_mint(
        CpiContext::new_with_signer(
            // Program involved
            ctx.accounts.token_program.to_account_info(),
            // IX accounts
            token::InitializeMint {
                mint: ctx.accounts.mint.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            // Signer Seeds
            &[&[
                DappTokenManager::SEED_PREFIX.as_bytes(),
                ctx.accounts.mint.key().as_ref(),
                caller_program.as_ref(),
            ]],
        ),
        9,
        &ctx.accounts.dapp_token_manager.key(), // mint authority
        Some(&ctx.accounts.dapp_token_manager.key()), // freeze authority
    )?;
    msg!(
        "Dapp Mint initialized! {:?}",
        &ctx.accounts.mint.to_account_info()
    );

    Ok(())
}

// -------- Accounts Validation Struct -------
#[derive(Accounts)]
#[instruction(caller_program: Pubkey, supply_amount_per_mint: u64)]
pub struct CreateDappTokenManager<'info> {
    // Client: Pass a Keypair
    #[account(mut)]
    pub mint: Signer<'info>,

    // Q: I want to store the caller_program. Do I have it as an Account,
    // or passed as instruction data?
    // U: Not sure...Going with IX data since this program is the 'puppet',
    // and the caller ('master') should have cpi::context.
    // E.g.:
    // #[account]
    // pub caller_program: Program<'info, CallerProgram>, //???

    // NOTE Add #[instruction(caller_program: Pubkey)] up top
    // so it's accessible (since I'm not passing it as an account)
    #[account(
        init,
        payer = authority,
        space = DappTokenManager::ACCOUNT_SPACE,
        seeds = [
            DappTokenManager::SEED_PREFIX.as_ref(),
            mint.key().as_ref(),
            caller_program.as_ref(),
        ],
        bump
    )]
    pub dapp_token_manager: Account<'info, DappTokenManager>,

    #[account(mut)]
    pub authority: Signer<'info>, // The fee payer (calling program wallet)

    pub rent: Sysvar<'info, Rent>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
