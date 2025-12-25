const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying TiltVaultManager...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Executor address - this is the TiltVault backend wallet that will execute trades
  // Use the hub wallet address from the backend
  const executorAddress = process.env.EXECUTOR_ADDRESS || deployer.address;
  console.log("Executor address:", executorAddress);

  // Deploy the contract
  const TiltVaultManager = await ethers.getContractFactory("TiltVaultManager");
  const manager = await TiltVaultManager.deploy(executorAddress);

  await manager.waitForDeployment();
  const contractAddress = await manager.getAddress();

  console.log("TiltVaultManager deployed to:", contractAddress);
  console.log("");
  console.log("=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log("");
  console.log("Contract Address:", contractAddress);
  console.log("Executor Address:", executorAddress);
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("");
  console.log("Next steps:");
  console.log("1. Verify the contract on Snowtrace:");
  console.log(`   npx hardhat verify --network avalanche ${contractAddress} ${executorAddress}`);
  console.log("");
  console.log("2. Update the frontend with the contract address");
  console.log("3. Update the backend API to use the contract");
  console.log("");

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    contractAddress,
    executorAddress,
    deployedAt: new Date().toISOString(),
    network: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address
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
