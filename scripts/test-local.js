// Local test suite for AgentPages — runs entirely in-process on a Ganache
// EVM (no external network). Usage: npm test
const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const artifact = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", `${name}.json`), "utf8"));

let passed = 0;
let failed = 0;

function ok(name, cond) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
  }
}

function errorTexts(e) {
  const texts = [];
  if (!e) return texts;
  for (const v of [e.reason, e.shortMessage, e.message, e.info && e.info.error && e.info.error.message]) {
    if (typeof v === "string" && v) texts.push(v);
  }
  // Try to decode a raw Error(string) payload (selector 0x08c379a0).
  for (const data of [e.data, e.info && e.info.error && e.info.error.data]) {
    if (typeof data === "string" && data.startsWith("0x08c379a0")) {
      try {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ["string"],
          "0x" + data.slice(10)
        );
        texts.push(decoded[0]);
      } catch (_) {
        /* ignore */
      }
    }
  }
  return texts;
}

async function expectRevert(name, promise, needle) {
  try {
    const tx = await promise;
    // A sent transaction only proves a revert once it is mined.
    if (tx && typeof tx.wait === "function") await tx.wait();
    failed++;
    console.log(`  FAIL  ${name} — expected revert, tx succeeded`);
  } catch (e) {
    const texts = errorTexts(e);
    const joined = texts.join(" | ");
    if (!needle || joined.includes(needle)) {
      passed++;
      console.log(`  PASS  ${name} (reverted: ${needle || "any"})`);
    } else {
      failed++;
      console.log(`  FAIL  ${name} — reverted with unexpected message: ${joined.slice(0, 160)}`);
    }
  }
}

async function main() {
  const ganacheProvider = ganache.provider({ logging: { quiet: true } });
  const provider = new ethers.BrowserProvider(ganacheProvider);

  const deployer = await provider.getSigner(0);
  const alice = await provider.getSigner(1); // Agent ID holder
  const bob = await provider.getSigner(2); // Agent ID holder
  const carol = await provider.getSigner(3); // NOT an Agent ID holder

  const aliceAddr = await alice.getAddress();
  const bobAddr = await bob.getAddress();
  const carolAddr = await carol.getAddress();

  // Deploy MockAgentID and give Alice + Bob an Agent ID (Carol gets none).
  const mockArtifact = artifact("MockAgentID");
  const Mock = new ethers.ContractFactory(mockArtifact.abi, mockArtifact.bytecode, deployer);
  const mock = await Mock.deploy();
  await mock.waitForDeployment();
  await (await mock.setBalance(aliceAddr, 1)).wait();
  await (await mock.setBalance(bobAddr, 1)).wait();
  console.log(`MockAgentID deployed at ${await mock.getAddress()}`);

  // Deploy AgentPages gated by the mock.
  const pagesArtifact = artifact("AgentPages");
  const Pages = new ethers.ContractFactory(pagesArtifact.abi, pagesArtifact.bytecode, deployer);
  const pages = await Pages.deploy(await mock.getAddress());
  await pages.waitForDeployment();
  const pagesAddr = await pages.getAddress();
  console.log(`AgentPages deployed at ${pagesAddr}\n`);

  const pagesAs = (signer) => pages.connect(signer);

  console.log("— Gate —");
  await expectRevert(
    "non-holder (Carol) cannot register",
    pagesAs(carol).register("Tools", "I have no Agent ID", "https://example.com"),
    "Agent ID required"
  );
  ok("totalAgents still 0 after rejected register", (await pages.totalAgents()) === 0n);

  console.log("— Register / update —");
  await (await pagesAs(alice).register("Trading", "Autonomous trading agent", "https://alice.example")).wait();
  let prof = await pages.profileOf(aliceAddr);
  ok("Alice registered with category", prof.profile.category === "Trading");
  ok("totalAgents == 1", (await pages.totalAgents()) === 1n);
  ok("registeredAt set", prof.profile.registeredAt > 0n);

  await (await pagesAs(alice).register("Research", "Updated pitch", "https://alice2.example")).wait();
  prof = await pages.profileOf(aliceAddr);
  ok("Alice update changes category", prof.profile.category === "Research");
  ok("Alice update changes pitch", prof.profile.pitch === "Updated pitch");
  ok("totalAgents still 1 after update", (await pages.totalAgents()) === 1n);
  ok("updatedAt >= registeredAt", prof.profile.updatedAt >= prof.profile.registeredAt);

  await expectRevert(
    "category over 32 bytes rejected",
    pagesAs(alice).register("x".repeat(33), "p", "u"),
    "Category too long"
  );
  await expectRevert(
    "pitch over 160 bytes rejected",
    pagesAs(alice).register("Tools", "x".repeat(161), "u"),
    "Pitch too long"
  );

  await (await pagesAs(bob).register("Content", "Content agent", "https://bob.example")).wait();
  ok("totalAgents == 2 after Bob", (await pages.totalAgents()) === 2n);

  console.log("— Endorse —");
  await expectRevert(
    "non-holder (Carol) cannot endorse",
    pagesAs(carol).endorse(aliceAddr),
    "Agent ID required"
  );
  await expectRevert(
    "self-endorsement rejected",
    pagesAs(alice).endorse(aliceAddr),
    "Cannot endorse yourself"
  );
  await expectRevert(
    "endorsing unregistered target rejected",
    pagesAs(alice).endorse(carolAddr),
    "Target not registered"
  );

  await (await pagesAs(bob).endorse(aliceAddr)).wait();
  ok("endorsementCountOf(Alice) == 1", (await pages.endorsementCountOf(aliceAddr)) === 1n);
  ok("profileOf reports endorsement count 1", (await pages.profileOf(aliceAddr)).endorsementCount === 1n);
  ok("hasEndorsed(Bob, Alice) == true", (await pages.hasEndorsed(bobAddr, aliceAddr)) === true);

  // staticCall: surfaces the decoded revert reason (a mined revert through
  // ganache does not carry the reason string back through .wait()).
  await expectRevert(
    "double endorsement rejected",
    pagesAs(bob).endorse.staticCall(aliceAddr),
    "Already endorsed"
  );
  ok("count still 1 after rejected double endorse", (await pages.endorsementCountOf(aliceAddr)) === 1n);

  await (await pagesAs(alice).endorse(bobAddr)).wait();
  ok("endorsementCountOf(Bob) == 1", (await pages.endorsementCountOf(bobAddr)) === 1n);

  console.log("— Notes —");
  await (await pagesAs(alice).postNote("Now scanning BNB Chain mempools")).wait();
  prof = await pages.profileOf(aliceAddr);
  ok("note stored on profile", prof.profile.note === "Now scanning BNB Chain mempools");
  ok("noteAt set", prof.profile.noteAt > 0n);
  await expectRevert(
    "note over 160 bytes rejected",
    pagesAs(alice).postNote("x".repeat(161)),
    "Note too long"
  );
  await expectRevert(
    "non-holder cannot post note",
    pagesAs(carol).postNote("hello"),
    "Agent ID required"
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  await ganacheProvider.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
