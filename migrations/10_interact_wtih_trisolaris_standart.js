const bigInt = require("big-integer");

const IERC20 = artifacts.require("IERC20");

// const swap_usdc_usdt_usn = "0x458459E48dbAC0C8Ca83F8D0b7b29FEfE60c3970";
const pool_usdc_usdt = "0x2fe064B6c7D274082aa5d2624709bC9AE7D16C77";

const usdc = "0xb12bfca5a55806aaf64e99521918a4bf0fc40802";
const usdt = "0x4988a896b1227218e4a686fde5eabdcabd91571f";
// const usn = "0x5183e1b1091804bc2602586919e6880ac1cf2896";
const AssetRouter = artifacts.require("UnoAssetRouterTrisolarisStandart");

module.exports = async function (deployer) {
  const assetRouter = await AssetRouter.deployed();
  console.log(`Farm is: ${assetRouter.address}`);

  let usdt_token = await IERC20.at(usdt);
  let usdc_token = await IERC20.at(usdc);

  let max_int = bigInt(2).pow(256).subtract(1);

  await usdt_token.approve(assetRouter.address, max_int.toString());
  console.log("USDT approved");

  await usdc_token.approve(assetRouter.address, max_int.toString());
  console.log("USDC approved");

  console.log("All tokens approved");

  let lp_token = await IERC20.at(pool_usdc_usdt);

  await lp_token.approve(assetRouter.address, max_int.toString());

  console.log("LP token approved");

  await assetRouter.deposit(pool_usdc_usdt, "10", "10", "0", "0", "0", "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a");

  console.log("Tokens are deposited");

  //   let toWithdraw = await assetRouter.userStake("0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a", swap_usdc_usdt_usn);

  //   console.log(toWithdraw.toString());

  //   await assetRouter.withdraw(swap_usdc_usdt_usn, toWithdraw.toString(), false, "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a");

  //   console.log("Tokens are withdrawn");
};
