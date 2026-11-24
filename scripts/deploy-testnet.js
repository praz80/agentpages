// Deploy MockAgentID + AgentPages to BSC TESTNET (chainId 97) with the
// project burner key (.deployer-key) and run the on-chain scenario.
// Usage: npm run deploy-testnet
// Requires the burner to hold testnet BNB (faucet). Never uses any wallet
// belonging to the project owner.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const RPC = process.env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com";
const CHAIN_ID = 97;

const artifact = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", `${name}.json`), "utf8"));

async function main() {
  const keyData = JSON.parse(fs.readFileSync(path.join(ROOT, ".deployer-key"), "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const wallet = new ethers.Wallet(keyData.privateKey, provider);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer (burner): ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} tBNB`);
  if (balance === 0n) {
    console.error(
      "BLOCKED: burner has 0 tBNB. Fund it from a BSC testnet faucet, then re-run."
    );
    process.exit(2);
  }

  // 1) Deploy MockAgentID (testnet stand-in for the real Agent ID contract).
  const mockArtifact = artifact("MockAgentID");
  const Mock = new ethers.ContractFactory(mockArtifact.abi, mockArtifact.bytecode, wallet);
  const mock = await Mock.deploy();
  await mock.waitForDeployment();
  const mockAddr = await mock.getAddress();
  console.log(`MockAgentID: ${mockAddr} (deploy tx ${mock.deploymentTransaction().hash})`);

  // 2) Deploy AgentPages gated by the mock.
  const pagesArtifact = artifact("AgentPages");
  const Pages = new ethers.ContractFactory(pagesArtifact.abi, pagesArtifact.bytecode, wallet);
  const pages = await Pages.deploy(mockAddr);
  await pages.waitForDeployment();
  const pagesAddr = await pages.getAddress();
  console.log(`AgentPages: ${pagesAddr} (deploy tx ${pages.deploymentTransaction().hash})`);

  // 3) On-chain scenario with the burner as the (mock) Agent ID holder.
  await (await mock.setBalance(wallet.address, 1)).wait();
  await (
    await pages.register("Directory", "AgentPages deployer profile (testnet)", "https://agentpages.example")
  ).wait();
  await (await pages.postNote("Testnet deployment live")).wait();

  const prof = await pages.profileOf(wallet.address);
  const total = await pages.totalAgents();
  console.log(`Scenario OK: totalAgents=${total}, category="${prof.profile.category}", note="${prof.profile.note}"`);

  const out = {
    network: "bsc-testnet",
    chainId: CHAIN_ID,
    deployer: wallet.address,
    mockAgentId: mockAddr,
    agentPages: pagesAddr,
    mockDeployTx: mock.deploymentTransaction().hash,
    agentPagesDeployTx: pages.deploymentTransaction().hash,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(ROOT, "deployments-testnet.json"), JSON.stringify(out, null, 2));
  console.log("Wrote deployments-testnet.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
