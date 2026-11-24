// Compile AgentPages.sol + MockAgentID.sol with solc-js into artifacts/.
// Usage: npm run compile
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.join(__dirname, "..");
const SOURCES = ["AgentPages.sol", "MockAgentID.sol"];

const input = {
  language: "Solidity",
  sources: {},
  settings: {
    // Paris target: newest solc defaults to Prague/Cancun opcodes (MCOPY,
    // TSTORE) that older EVMs (Ganache default fork) reject as invalid
    // opcode. Paris bytecode runs everywhere, including BSC.
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

for (const file of SOURCES) {
  input.sources[file] = {
    content: fs.readFileSync(path.join(ROOT, "contracts", file), "utf8"),
  };
}

function findImports(importPath) {
  const local = path.join(ROOT, "contracts", importPath);
  if (fs.existsSync(local)) {
    return { contents: fs.readFileSync(local, "utf8") };
  }
  return { error: "File not found: " + importPath };
}

const output = JSON.parse(
  solc.compile(JSON.stringify(input), { import: findImports })
);

let failed = false;
for (const entry of output.errors || []) {
  const line = `${entry.severity}: ${entry.formattedMessage || entry.message}`;
  if (entry.severity === "error") {
    failed = true;
    console.error(line);
  } else {
    console.warn(line);
  }
}
if (failed) {
  console.error("Compilation FAILED");
  process.exit(1);
}

fs.mkdirSync(path.join(ROOT, "artifacts"), { recursive: true });
for (const file of SOURCES) {
  const contracts = output.contracts[file];
  for (const [name, compiled] of Object.entries(contracts)) {
    const artifact = {
      contractName: name,
      sourceName: file,
      abi: compiled.abi,
      bytecode: "0x" + compiled.evm.bytecode.object,
    };
    const outPath = path.join(ROOT, "artifacts", `${name}.json`);
    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(
      `compiled ${name} -> artifacts/${name}.json (bytecode ${compiled.evm.bytecode.object.length / 2} bytes)`
    );
  }
}
console.log("Compilation OK");
