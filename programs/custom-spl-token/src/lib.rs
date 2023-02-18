// https://www.youtube.com/watch?v=c1GJ-13z6pE&list=PLUBKxx7QjtVnU3hkPc8GF1Jh4DE7cf4n1&index=8
use {
    anchor_lang::{prelude::*, system_program},
    anchor_spl::{associated_token, token},
};

// Q: For master to CPI this program (e.g., mint more supply, transfer),
// does it need to be set as the mint_authority of the mint account?
// Which means we'd maybe need to first create a PDA between the masterProgram
// and the mint account, and inside there is an ATA? Thinking of Escrow account
// and its ATA.

declare_id!("cPshoEnza1TMdWGRkQyiQQqu34iMDTc7i3XT8uVVfjp");

#[program]
pub mod custom_spl_token {
    use super::*;

    pub fn initialize_spl(
        ctx: Context<InitializeSpl>
    ) -> Result<()> {
        // Invoke a Cross-program Invocation:
        // NOTE Hits another program by sending required accounts
        // Q: Is this the spl-token create-account <TOKEN_ADDRESS> command?
        // A: NO! I believe this is the CPI to SystemProgram, which creates
        // a fresh account and makes the Token Program its owner.
        msg!("1. Creating account for the actual mint (token)...");
        // msg!("Mint: {}", &ctx.accounts.mint.key());
        system_program::create_account(
            // NOTE The CpiContext stores the program and Accounts
            CpiContext::new(
                // NOTE Every CpiContext takes a program ID and instruction
                // NOTE Program = What program to hit
                // NOTE Instructions = What instructions to pass to the program
                // NOTE Everything is AccountInfo in CpiContext
                // IMPORTANT I believe this is equivalent to AccountInfo[]:
                //
                // &[
                //     mint.clone(), // Clone so ownership isn't moved into each tx
                //     mint_authority.clone(),
                //     token_program.clone(),
                // ]
                ctx.accounts.token_program.to_account_info(),
                system_program::CreateAccount {
                    // Our wallet is paying to create the mint account
                    from: ctx.accounts.mint_authority.to_account_info(), // wallet
                    to: ctx.accounts.mint.to_account_info(),             // mint
                },
            ),
            // Additional params
            10000000,                          // Lamports
            82,                                // Size
            &ctx.accounts.token_program.key(), // Owner i.e. Token Program owns the Mint account
        )?;

        // Q: Is this the spl-token create-account <TOKEN_ADDRESS> command?
        // A: NO! This is spl-token create-token --decimals 0
        // NOTE --decimals 0 is the protocol for NFTs
        msg!("2. Initializing mint account as a mint...");
        // msg!("Mint: {}", &ctx.accounts.mint.key());
        token::initialize_mint(
            CpiContext::new(
                // Q: Do I use to_account_info() or key()?
                // A: MUST use to_account_info() inside CpiContext
                // NOTE Don't use '&' references when using to_account_info()
                // Only use '&' when referencing Pubkeys
                ctx.accounts.token_program.to_account_info(), // Pinging Token Program
                // Q: What about mint_authority account? Where does it go?
                // A: It's still present, just passed as arg to initialize_mint(),
                // instead of inside CpiContext. Not 100% sure why...
                token::InitializeMint {
                    // Instructions
                    mint: ctx.accounts.mint.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
            ),
            9,                                        // Decimals - Set to 0 for NFTs
            &ctx.accounts.mint_authority.key(),       // authority
            Some(&ctx.accounts.mint_authority.key()), // freeze authority
        )?;

        // Q: Is this spl-token create-account <TOKEN_ADDRESS> <OWNER_ADDRESS>?
        // A: Yes, I believe this is more-or-less the equivalent, BUT it's hitting
        // the Associated Token Program, which hits the main Token Program, which itself
        // hits the System Program that creates the ATA.
        // Q: Does the System Program assign the Associated Token Program OR
        // the Token Program as the OWNER of the ATA? Is there even an Owner to ATAs? Probably...
        // NOTE When running this CLI command, the owner of account is our local keypair account
        // NOTE This create-account command literally adds the token account (token holdings) inside owner's wallet!
        // Q: Is this the Token Metadata Program creating the Metadata Account for the token?
        // A: Don't believe so because this comes later with steps 5 and 6 w/ Metaplex
        msg!("3. Creating associated token account for the mint and the wallet...");
        // msg!("Token Address: {}", &ctx.accounts.token_account.to_account_info().key());
        associated_token::create(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            associated_token::Create {
                payer: ctx.accounts.mint_authority.to_account_info(),
                associated_token: ctx.accounts.token_account.to_account_info(),
                // Q: How do you know which is the authority? Authority of what?
                // The wallet that this ATA is getting added to? Perhaps...
                // A: Yes! It's the owner's wallet <OWNER_ADDRESS> that has authority of this new ATA!
                authority: ctx.accounts.mint_authority.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                // NOTE Still need main token_program to create associated token account
                token_program: ctx.accounts.token_program.to_account_info(),
            }, 
               
        ))?;

        // Q: Is this spl-token mint <TOKEN_ADDRESS> <AMOUNT> <RECIPIENT_ADDRESS>?
        // A: Yes! This mints (increases supply of Token) and transfers new tokens
        // to owner's token account (default recipient token address) balance
        msg!("4. Minting token to the token account (i.e. give it 1 for NFT)...");
        // msg!("Mint: {}", &ctx.accounts.mint.key());
        // msg!("Token Address: {}", &ctx.accounts.token_account.to_account_info().key());
        token::mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(), // Program to ping
                token::MintTo {
                    // Instructions with accounts to pass to program
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                }, // Q: Why not pass rent account? We do in the raw version
                                                              // NOTE I believe the raw INSTRUCTION corresponds (mostly) to the
                                                              // Anchor CpiContext. It's not 100%, but seems to be mostly the case
            ),
            // Additonal args
            1, // amount
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeSpl<'info> {
    // NOTE Anchor uses a Struct to handle all the accounts needed for tx:
    // let mint = next_account_info(accounts_iter)?; // Create a new mint (token)
    // let token_account = next_account_info(accounts_iter)?; // Create a token account for the mint
    // let mint_authority = next_account_info(accounts_iter)?; // Our wallet
    // let rent = next_account_info(accounts_iter)?; // Sysvar but still an account
    // let system_program = next_account_info(accounts_iter)?;
    // let token_program = next_account_info(accounts_iter)?;
    // let associated_token_program = next_account_info(accounts_iter)?;
    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: We're about to create this with Anchor inside transaction
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    #[account(mut)]
    pub mint_authority: Signer<'info>, // The wallet

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, token::Token>,
    pub associated_token_program: Program<'info, associated_token::AssociatedToken>,

}
