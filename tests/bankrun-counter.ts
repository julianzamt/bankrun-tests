import * as anchor from "@coral-xyz/anchor";
import {
  startAnchor,
  ProgramTestContext,
  Clock,
  BanksClient,
} from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { BankrunCounter } from "../target/types/bankrun_counter";
import { expect } from "chai";
import {
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  transfer,
} from "spl-token-bankrun";
import * as helpers from "./helpers";

describe("bankrun-counter", () => {
  const BCMintInitialSupply = 100;
  const BCMintDecimals = 0;

  let program: anchor.Program<BankrunCounter>;
  let provider: BankrunProvider;
  let context: ProgramTestContext;
  let banksClient: BanksClient;

  let counterAddress: anchor.web3.PublicKey;

  let BCMint: anchor.web3.PublicKey;
  let pdaAuth: anchor.web3.PublicKey;
  let pdaAuthAta: anchor.web3.PublicKey;
  let providerWalletAta: anchor.web3.PublicKey;

  let anotherReceiver = anchor.web3.Keypair.generate();
  let anotherReceiverAta: anchor.web3.PublicKey;

  let now: number;

  before(async () => {
    context = await startAnchor("./", [], []);

    banksClient = context.banksClient;

    provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    program = anchor.workspace.BankrunCounter as anchor.Program<BankrunCounter>;

    [counterAddress] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("counter"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    [pdaAuth] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pda_auth")],
      program.programId
    );

    BCMint = await createMint(
      banksClient,
      provider.wallet.payer,
      provider.wallet.publicKey,
      null,
      BCMintDecimals
    );

    pdaAuthAta = await createAssociatedTokenAccount(
      banksClient,
      provider.wallet.payer,
      BCMint,
      pdaAuth
    );

    providerWalletAta = await getAssociatedTokenAddress(
      BCMint,
      provider.wallet.publicKey
    );

    anotherReceiverAta = await createAssociatedTokenAccount(
      banksClient,
      provider.wallet.payer,
      BCMint,
      anotherReceiver.publicKey
    );

    // console.log("walet: ", provider.wallet.publicKey.toString());
    // console.log("pdaAuthAta: ", pdaAuthAta);

    await mintTo(
      banksClient,
      provider.wallet.payer,
      BCMint,
      pdaAuthAta,
      provider.wallet.publicKey,
      BCMintInitialSupply
    );

    let unpackedAccount = await helpers.getTokenAccountInfoBR(
      banksClient,
      pdaAuthAta
    );

    expect(Number(unpackedAccount.amount)).to.eq(BCMintInitialSupply);

    now = Math.round(Date.now() / 1000);
  });

  it("Sol transfer", async () => {
    const transferLamports = BigInt(100 * anchor.web3.LAMPORTS_PER_SOL);
    const ixs = [
      anchor.web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: anotherReceiver.publicKey,
        lamports: transferLamports,
      }),
    ];

    const tx = new anchor.web3.Transaction();
    [tx.recentBlockhash] = await banksClient.getLatestBlockhash();
    tx.add(...ixs);
    tx.sign(provider.wallet.payer);
    await banksClient.processTransaction(tx);
    const balanceAfter = await banksClient.getBalance(
      anotherReceiver.publicKey
    );
    expect(balanceAfter).to.eq(transferLamports);
  });

  it("Add one", async () => {
    await program.methods
      .addOne()
      .accounts({
        counter: counterAddress,
      })
      .rpc();

    let counter = await program.account.counter.fetch(counterAddress);

    expect(counter.counter.toString()).to.eq("1");
  });

  it("Cannot add again before 5 mins", async () => {
    let tx = new anchor.web3.Transaction().add(
      await program.methods
        .addOne()
        .accounts({
          counter: counterAddress,
        })
        .instruction()
    );

    // Send tx
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = provider.wallet.publicKey;

    tx.sign(provider.wallet.payer);

    const res = await context.banksClient.tryProcessTransaction(tx);

    expect(res.meta?.logMessages.join("").includes("CannotAddYet")).to.be.true;
  });

  it("Can add again after 5 minutes - Bankrun forwards time", async () => {
    now += 6 * 60;

    const currentClock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        BigInt(now)
      )
    );

    await program.methods
      .addOne()
      .accounts({
        counter: counterAddress,
      })
      .rpc();

    let counter = await program.account.counter.fetch(counterAddress);

    expect(counter.counter.toString()).to.eq("2");
  });

  it("Can execute transferOnetoken", async () => {
    await program.methods
      .transferOneToken()
      .accounts({
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        bankrunCounterMint: BCMint,
        pdaAuth,
        pdaAuthAta,
        receiver: provider.wallet.publicKey,
        receiverAta: providerWalletAta,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    let unpackedAccount = await helpers.getTokenAccountInfoBR(
      banksClient,
      providerWalletAta
    );

    expect(Number(unpackedAccount.amount)).to.eq(1);
  });

  it("Cannot transferOnetoken until 5 minutes after the last tx", async () => {
    let tx = new anchor.web3.Transaction().add(
      await program.methods
        .transferOneToken()
        .accounts({
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          bankrunCounterMint: BCMint,
          pdaAuth,
          pdaAuthAta,
          receiver: provider.wallet.publicKey,
          receiverAta: providerWalletAta,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction()
    );

    // Send tx
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = provider.wallet.publicKey;

    tx.sign(provider.wallet.payer);

    const res = await context.banksClient.tryProcessTransaction(tx);

    expect(res.meta?.logMessages.join("").includes("CannotTransferYet")).to.be
      .true;
  });

  it("Can transferOnetoken again after 5 minutes - Bankrun forwards time", async () => {
    now += 6 * 60;

    const currentClock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        BigInt(now)
      )
    );

    await program.methods
      .transferOneToken()
      .accounts({
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        bankrunCounterMint: BCMint,
        pdaAuth,
        pdaAuthAta,
        receiver: provider.wallet.publicKey,
        receiverAta: providerWalletAta,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    let unpackedAccount = await helpers.getTokenAccountInfoBR(
      banksClient,
      providerWalletAta
    );

    expect(Number(unpackedAccount.amount)).to.eq(2);
  });

  it("Can transfer tokens beetween accounts", async () => {
    await transfer(
      banksClient,
      provider.wallet.payer,
      providerWalletAta,
      anotherReceiverAta,
      provider.wallet.publicKey,
      1
    );

    let unpackedAccount = await helpers.getTokenAccountInfoBR(
      banksClient,
      anotherReceiverAta
    );

    expect(Number(unpackedAccount.amount)).to.eq(1);
  });
});
