const ether = require("@openzeppelin/test-helpers/src/ether");
const bigInt = require("big-integer");

const IERC20 = artifacts.require("IERC20");
const IUniswapV2Pair = artifacts.require("IUniswapV2Pair");

// const swap_usdc_usdt_usn = "0x458459E48dbAC0C8Ca83F8D0b7b29FEfE60c3970";
const pool_usdc_usdt = "0x2fe064B6c7D274082aa5d2624709bC9AE7D16C77";

const AssetRouter = artifacts.require("UnoAssetRouterTrisolarisStandart");
const FarmFactory = artifacts.require("UnoFarmFactory");

const timeMachine = require("ganache-time-traveler");
const Web3 = require("web3");

module.exports = async function (deployer, accounts) {
    // const assetRouter = await AssetRouter.deployed();
    // console.log(`Farm is: ${assetRouter.address}`);
    // const farmFactory = await FarmFactory.deployed();
    // console.log(`FarmFactory is: ${farmFactory.address}`);
    // let farmBeacon = await farmFactory.farmBeacon();
    // let accessManager = await farmFactory.accessManager();
    // let _assetRouter = await farmFactory.assetRouter();
    // console.log(
    //     `**\nFarm Beacon: ${farmBeacon}\nAccess Manager: ${accessManager}\nAsset Router: ${_assetRouter}\n**`,
    // );
    // let pair = await IUniswapV2Pair.at(pool_usdc_usdt);
    // console.log(`Pair is: ${pair.address}`);
    // let token0 = await pair.token0();
    // let token1 = await pair.token1();
    // console.log(`${token0}, ${token1}`);
    // let usdt_token = await IERC20.at(token0);
    // let usdc_token = await IERC20.at(token1);
    // let max_int = bigInt(2).pow(256).subtract(1);
    // await usdt_token.approve(assetRouter.address, max_int.toString(), {
    //     from: "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    // });
    // console.log("USDT approved");
    // await usdc_token.approve(assetRouter.address, max_int.toString(), {
    //     from: "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    // });
    // console.log("USDC approved");
    // console.log("All tokens approved");
    // let lp_token = await IERC20.at(pool_usdc_usdt);
    // await lp_token.approve(assetRouter.address, max_int.toString(), {
    //     from: "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    // });
    // console.log("LP token approved");
    // let allowance_usdt = await usdt_token.allowance(
    //     "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    //     assetRouter.address,
    // );
    // let allowance_usdc = await usdc_token.allowance(
    //     "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    //     assetRouter.address,
    // );
    // let allowance_lp_token = await lp_token.allowance(
    //     "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    //     assetRouter.address,
    // );
    // console.log(
    //     `**\nAllowance: \nUSDT: ${allowance_usdt}\nUSDC: ${allowance_usdc}\nLP_Token: ${allowance_lp_token}\n**`,
    // );
    // let usdt_balance = await usdt_token.balanceOf("0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a");
    // let usdc_balance = await usdc_token.balanceOf("0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a");
    // let lp_token_balance = await lp_token.balanceOf("0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a");
    // console.log(
    //     `**\nAccount balances: \nUSDT: ${usdt_balance}\nUSDC: ${usdc_balance}\nLP_Token: ${lp_token_balance}\n**`,
    // );
    // await assetRouter.deposit(
    //     pool_usdc_usdt,
    //     "10000",
    //     "10000",
    //     "0",
    //     "0",
    //     "104",
    //     "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    //     { from: "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a" },
    // );
    // console.log("Tokens are deposited");
    // let farm = (await farmFactory.Farms(pool_usdc_usdt)).toString();
    // console.log(farm);
    // // await timeMachine.advanceTimeAndBlock(1000);
    // await assetRouter.distribute(
    //     pool_usdc_usdt,
    //     [
    //         "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
    //         "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
    //         "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
    //         "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
    //     ],
    //     [
    //         "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
    //         "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
    //     ],
    //     [
    //         "0x0000000000000000000000000000000000000000",
    //         "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
    //     ],
    //     [
    //         "0x0000000000000000000000000000000000000000",
    //         "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
    //     ],
    //     [1, 1, 1, 1],
    //     { from: "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a" },
    // );
    // let userStake = await assetRouter.userStake(
    //     "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    //     pool_usdc_usdt,
    // );
    // let toWithdraw = userStake["0"].toString();
    // console.log(toWithdraw);
    // await assetRouter.withdraw(
    //     pool_usdc_usdt,
    //     toWithdraw.toString(),
    //     "0",
    //     "0",
    //     false,
    //     "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    //     { from: "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a" },
    // );
    // console.log("Tokens are withdrawn");
    // usdt_balance = await usdt_token.balanceOf("0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a");
    // usdc_balance = await usdc_token.balanceOf("0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a");
    // lp_token_balance = await lp_token.balanceOf("0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a");
    // console.log(
    //     `**\nAccount balances: \nUSDT: ${usdt_balance}\nUSDC: ${usdc_balance}\nLP_Token: ${lp_token_balance}\n**`,
    // );
};
