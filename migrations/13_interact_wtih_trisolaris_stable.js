const ether = require("@openzeppelin/test-helpers/src/ether");
const bigInt = require("big-integer");

const IERC20 = artifacts.require("IERC20");
const ISwap = artifacts.require("ISwap");

// const swap_usdc_usdt_usn = "0x458459E48dbAC0C8Ca83F8D0b7b29FEfE60c3970";
const swap_usdc_usdt_usn = "0x458459E48dbAC0C8Ca83F8D0b7b29FEfE60c3970";

const AssetRouter = artifacts.require("UnoAssetRouterTrisolarisStable");
const FarmFactory = artifacts.require("UnoFarmFactory");

const from_address = "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a";

module.exports = async function (deployer, accounts) {
  const assetRouter = await AssetRouter.deployed();
  console.log(`Farm is: ${assetRouter.address}`);

  const farmFactory = await FarmFactory.deployed();
  console.log(`FarmFactory is: ${farmFactory.address}`);

  let farmBeacon = await farmFactory.farmBeacon();
  let accessManager = await farmFactory.accessManager();
  let _assetRouter = await farmFactory.assetRouter();

  console.log(`**\nFarm Beacon: ${farmBeacon}\nAccess Manager: ${accessManager}\nAsset Router: ${_assetRouter}\n**`);

  let swap = await ISwap.at(swap_usdc_usdt_usn);

  console.log(`Swap is: ${swap.address}`);

  let token0 = await swap.getToken("0");
  let token1 = await swap.getToken("1");
  let token2 = await swap.getToken("2");

  console.log(`**\n${token0}\n${token1}\n${token2}\n**`);

  let usdt_token = await IERC20.at(token0);
  let usdc_token = await IERC20.at(token1);
  let usn_token = await IERC20.at(token2);

  let max_int = bigInt(2).pow(256).subtract(1);

  await usdt_token.approve(assetRouter.address, max_int.toString(), { from: from_address });
  console.log("USDT approved");

  await usdc_token.approve(assetRouter.address, max_int.toString(), { from: from_address });
  console.log("USDC approved");

  await usn_token.approve(assetRouter.address, max_int.toString(), { from: from_address });
  console.log("USN approved");

  console.log("All tokens approved");

  let swapStorage = await swap.swapStorage();
  let lp_token = await IERC20.at(swapStorage["6"].toString());

  await lp_token.approve(assetRouter.address, max_int.toString(), { from: from_address });

  console.log("LP token approved");

  let allowance_usdt = await usdt_token.allowance(from_address, assetRouter.address);
  let allowance_usdc = await usdc_token.allowance(from_address, assetRouter.address);
  let allowance_usn = await usn_token.allowance(from_address, assetRouter.address);
  let allowance_lp_token = await lp_token.allowance(from_address, assetRouter.address);

  console.log(`**\nAllowances: \nUSDT: ${allowance_usdt}\nUSDC: ${allowance_usdc}\nUSN: ${allowance_usn}\nLP_Token: ${allowance_lp_token}\n**`);

  let usdt_balance = await usdt_token.balanceOf(from_address);
  let usdc_balance = await usdc_token.balanceOf(from_address);
  let usn_balance = await usn_token.balanceOf(from_address);
  let lp_token_balance = await lp_token.balanceOf(from_address);

  console.log(`**\nAccount balances: \nUSDT: ${usdt_balance}\nUSDC: ${usdc_balance}\nUSN: ${usn_balance}\nLP_Token: ${lp_token_balance}\n**`);

  await assetRouter.deposit(swap_usdc_usdt_usn, ["10", "10", "10"], "0", "0", from_address, { from: from_address });

  console.log("Tokens are deposited");
  // let usdt_balance = await usdt_token.balanceOf(from_address);
  // let usdc_balance = await usdc_token.balanceOf(from_address);
  // let lp_token_balance = await lp_token.balanceOf(from_address);

  // console.log(`**\nAccount balances: \nUSDT: ${usdt_balance}\nUSDC: ${usdc_balance}\nLP_Token: ${lp_token_balance}\n**`);
};
