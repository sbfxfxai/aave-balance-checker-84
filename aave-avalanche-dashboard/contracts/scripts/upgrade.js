const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("Upgrading TiltVaultManagerV2...");

  // Get proxy address from deployment.json or environment
  const fs = require("fs");
  let proxyAddress;
  
  if (fs.existsSync("./deployment.json")) {
    const deployment = JSON.parse(fs.readFileSync("./deployment.json", "utf8"));
    proxyAddress = deployment.proxyAddress;
  } else {
    proxyAddress = process.env.PROXY_ADDRESS;
  }

  if (!proxyAddress) {
    throw new Error("Proxy address not found. Set PROXY_ADDRESS env var or deployment.json");
  }

  console.log("Proxy address:", proxyAddress);

  const [deployer] = await ethers.getSigners();
  console.log("Upgrading with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Get current implementation
  const currentImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("Current implementation:", currentImplementation);

  // Deploy new implementation
  const TiltVaultManagerV2 = await ethers.getContractFactory("TiltVaultManagerV2");
  
  console.log("Upgrading proxy to new implementation...");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, TiltVaultManagerV2);
  
  await upgraded.waitForDeployment();
  
  // Get new implementation address
  const newImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  
  console.log("");
  console.log("=".repeat(60));
  console.log("UPGRADE COMPLETE");
  console.log("=".repeat(60));
  console.log("");
  console.log("Proxy Address (unchanged):", proxyAddress);
  console.log("Old Implementation:", currentImplementation);
  console.log("New Implementation:", newImplementation);
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("");
  console.log("Next steps:");
  console.log("1. Verify the new implementation contract on Snowtrace:");
  console.log(`   npx hardhat verify --network avalanche ${newImplementation}`);
  console.log("");
  console.log("2. Test the upgraded contract");
  console.log("3. Update version number in contract (if needed)");
  console.log("");

  // Update deployment info
  if (fs.existsSync("./deployment.json")) {
    const deployment = JSON.parse(fs.readFileSync("./deployment.json", "utf8"));
    deployment.previousImplementation = currentImplementation;
    deployment.implementationAddress = newImplementation;
    deployment.upgradedAt = new Date().toISOString();
    deployment.upgradedBy = deployer.address;
    
    fs.writeFileSync(
      "./deployment.json",
      JSON.stringify(deployment, null, 2)
    );
    console.log("Deployment info updated in deployment.json");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

