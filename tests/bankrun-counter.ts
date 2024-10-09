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
  unpackAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
} from "spl-token-bankrun";

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
  let receiverAta: anchor.web3.PublicKey;

  let simpleTransferReceiver = anchor.web3.Keypair.generate();

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

    receiverAta = await getAssociatedTokenAddress(
      BCMint,
      provider.wallet.publicKey
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

    let packedAccount = await banksClient.getAccount(pdaAuthAta);

    let packedAccountBuffer: anchor.web3.AccountInfo<Buffer> = {
      ...packedAccount,
      data: Buffer.from(packedAccount.data),
    };

    let unpackedAccount = await unpackAccount(pdaAuthAta, packedAccountBuffer);

    // console.log(unpackedAccount);

    expect(Number(unpackedAccount.amount)).to.eq(BCMintInitialSupply);

    now = Math.round(Date.now() / 1000);
  });

  it("simple transfer", async () => {
    const transferLamports = BigInt(100 * anchor.web3.LAMPORTS_PER_SOL);
    const ixs = [
      anchor.web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: simpleTransferReceiver.publicKey,
        lamports: transferLamports,
      }),
    ];

    const tx = new anchor.web3.Transaction();
    [tx.recentBlockhash] = await banksClient.getLatestBlockhash();
    tx.add(...ixs);
    tx.sign(provider.wallet.payer);
    await banksClient.processTransaction(tx);
    const balanceAfter = await banksClient.getBalance(
      simpleTransferReceiver.publicKey
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

  it("Can transfer tokens", async () => {
    await program.methods
      .transferOneToken()
      .accounts({
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        bankrunCounterMint: BCMint,
        pdaAuth,
        pdaAuthAta,
        receiver: provider.wallet.publicKey,
        receiverAta,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    let packedAccount = await banksClient.getAccount(receiverAta);

    let packedAccountBuffer: anchor.web3.AccountInfo<Buffer> = {
      ...packedAccount,
      data: Buffer.from(packedAccount.data),
    };

    let unpackedAccount = await unpackAccount(receiverAta, packedAccountBuffer);

    expect(Number(unpackedAccount.amount)).to.eq(1);
  });

  it("Cannot transfer until 5 minutes after the last tx", async () => {
    let tx = new anchor.web3.Transaction().add(
      await program.methods
        .transferOneToken()
        .accounts({
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          bankrunCounterMint: BCMint,
          pdaAuth,
          pdaAuthAta,
          receiver: provider.wallet.publicKey,
          receiverAta,
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

  it("Can transfer again after 5 minutes - Bankrun forwards time", async () => {
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
        receiverAta,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    let packedAccount = await banksClient.getAccount(receiverAta);

    let packedAccountBuffer: anchor.web3.AccountInfo<Buffer> = {
      ...packedAccount,
      data: Buffer.from(packedAccount.data),
    };

    let unpackedAccount = await unpackAccount(receiverAta, packedAccountBuffer);

    expect(Number(unpackedAccount.amount)).to.eq(2);
  });
});
