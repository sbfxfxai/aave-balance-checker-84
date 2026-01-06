const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("Deploying TiltVaultManagerV2 (Upgradeable)...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Executor address - this is the TiltVault backend wallet that will execute trades
  const executorAddress = process.env.EXECUTOR_ADDRESS || deployer.address;
  console.log("Executor address:", executorAddress);

  // Deploy the upgradeable contract
  const TiltVaultManagerV2 = await ethers.getContractFactory("TiltVaultManagerV2");
  
  console.log("Deploying proxy and implementation...");
  const manager = await upgrades.deployProxy(
    TiltVaultManagerV2,
    [executorAddress],
    {
      initializer: "initialize",
      kind: "uups" // UUPS proxy pattern (more gas efficient)
    }
  );

  await manager.waitForDeployment();
  
  // Get proxy address (this is what users interact with)
  const proxyAddress = await manager.getAddress();
  
  // Get implementation address
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  
  // Get admin address (for UUPS, admin is the proxy itself initially)
  const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);

  console.log("");
  console.log("=".repeat(60));
  console.log("UPGRADEABLE DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log("");
  console.log("Proxy Address (use this):", proxyAddress);
  console.log("Implementation Address:", implementationAddress);
  console.log("Admin Address:", adminAddress);
  console.log("Executor Address:", executorAddress);
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("");
  console.log("Next steps:");
  console.log("1. Verify the implementation contract on Snowtrace:");
  console.log(`   npx hardhat verify --network avalanche ${implementationAddress}`);
  console.log("");
  console.log("2. Update the frontend with the proxy address");
  console.log("3. Update the backend API to use the proxy address");
  console.log("4. Store proxy and implementation addresses securely");
  console.log("");

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    proxyAddress,
    implementationAddress,
    adminAddress,
    executorAddress,
    deployedAt: new Date().toISOString(),
    network: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    upgradeable: true,
    proxyType: "UUPS"
  };

  fs.writeFileSync(
    "./deployment.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("Deployment info saved to deployment.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

