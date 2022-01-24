// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Router.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/IMiniChefV2.sol";
import "./interfaces/IRewarder.sol";
import "./interfaces/IStakingRewards.sol";
import "./interfaces/IStakingDualRewards.sol";

contract UnoInfo {
    using SafeMath for uint256;

    IUniswapV2Router01 constant private quickswapRouter = IUniswapV2Router01(0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff);
    IUniswapV2Router01 constant private sushiswapRouter = IUniswapV2Router01(0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506);
    IUniswapV2Factory constant private sushiswapFactory = IUniswapV2Factory(0xc35DADB65012eC5796536bD9864eD8773aBc74C4);
    IUniswapV2Factory constant private quickswapFactory = IUniswapV2Factory(0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32);
    IMiniChefV2 constant private miniChef = IMiniChefV2(0x0769fd68dFb93167989C6f7254cd0D766Fb2841F);
    IRewarder constant private complexRewarderTime = IRewarder(0xa3378Ca78633B3b9b2255EAa26748770211163AE);

    address constant private SUSHI = address(0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a);
    address constant private WMATIC = address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270);
    address constant private WETH = address(0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619);
    address constant private USDC = address(0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174);

    bytes32 QUICKSWAP = keccak256(bytes('quickswap'));
    bytes32 QUICKSWAPDUAL = keccak256(bytes('quickswapDual'));
    bytes32 SUSHISWAP = keccak256(bytes('sushiswap'));

    function getLPPrice(address lpPool, uint256 value, string memory app) external view returns (uint256) {
        if(keccak256(bytes(app)) == QUICKSWAP || keccak256(bytes(app)) == QUICKSWAPDUAL){
            return quickswapLPPrice(lpPool, value);
        }
        if(keccak256(bytes(app)) == SUSHISWAP){
            return sushiswapLPPrice(lpPool, value);
        }
        return 0;
    }

    function getRewardRate(address lpPool, string memory app) external view returns (uint256) {
        if(keccak256(bytes(app)) == QUICKSWAP){
            return quickswapRewardRate(lpPool);
        }
        if(keccak256(bytes(app)) == QUICKSWAPDUAL){
            return quickswapDualRewardRate(lpPool);
        }
        if(keccak256(bytes(app)) == SUSHISWAP){
            return sushiswapRewardRate(lpPool);
        }
        return 0;
    }

    function getRewardsToken(address lpPool, string memory app) external view returns (address) {
        if(keccak256(bytes(app)) == QUICKSWAP){
            return getQuickswapRewardsToken(lpPool);
        }
        if(keccak256(bytes(app)) == QUICKSWAPDUAL){
            return getQuickswapDualRewardsToken();
        }
        if(keccak256(bytes(app)) == SUSHISWAP){
            return getSushiswapRewardsToken();
        }
        return address(0);
    }

    function getQuickswapRewardsToken(address lpPool) internal view returns (address){
       return IStakingRewards(lpPool).rewardsToken();
    }
    function getQuickswapDualRewardsToken() internal pure returns (address){
       return WMATIC;
    }
    function getSushiswapRewardsToken() internal pure returns (address){
       return SUSHI;
    }

    /**
    * @dev Returns the price for the given pair (WMATIC)
    */ 
    function quickswapLPPrice(address lpPair, uint256 value) internal view returns (uint256) {//make price returned not affected by slippage rate
        uint256 totalSupply = IERC20(lpPair).totalSupply();
        address token0 = IUniswapV2Pair(lpPair).token0();
        uint256 totalTokenAmount = IERC20(token0).balanceOf(lpPair).mul(2);
        uint256 amountIn = value.mul(totalTokenAmount).div(totalSupply);
        
        if(amountIn == 0 || token0 == WMATIC){
             return amountIn;
        }
        address[] memory route;
        if(quickswapFactory.getPair(token0, WMATIC) == address(0)){
            route =  new address[](3);
            route[0] = token0;
            route[1] = USDC;
            route[2] = WMATIC;
        }else{
            route =  new address[](2);
            route[0] = token0;
            route[1] = WMATIC;
        }
        uint256[] memory price = quickswapRouter.getAmountsOut(amountIn, route);
        return price[price.length - 1];
    }

    function sushiswapLPPrice(address lpPair, uint256 value) internal view returns (uint256) {//make price returned not affected by slippage rate
      uint256 totalSupply = IERC20(lpPair).totalSupply();
      address token0 = IUniswapV2Pair(lpPair).token0();
      uint256 totalTokenAmount = IERC20(token0).balanceOf(lpPair).mul(2);
         
      uint256 amountIn = value.mul(totalTokenAmount).div(totalSupply);

      if(amountIn == 0 || token0 == WMATIC){
          return amountIn;
      }
      
      address[] memory route;
      if(token0 == WETH){
          route = new address[](2);
          route[0] = WETH;
          route[1] = WMATIC;
      }else{
          if(sushiswapFactory.getPair(token0, WETH) == address(0)){
              return 0;
          }
          route = new address[](3);
          route[0] = token0;
          route[1] = WETH;
          route[2] = WMATIC;
      }

      uint256[] memory price = sushiswapRouter.getAmountsOut(amountIn, route);
      return price[price.length - 1];
    }

    
    /**
     * @dev Returns current reward rate.
     */ 
    function quickswapRewardRate(address lpStakingPool) internal view returns (uint256) {
        return IStakingRewards(lpStakingPool).rewardRate();
    }

    /**
     * @dev Returns current reward rate. (WMATIC)
     */ 
    function quickswapDualRewardRate(address lpStakingPool) internal view returns(uint256){
        uint256 rewardRateA = IStakingDualRewards(lpStakingPool).rewardRateA();
        address rewardTokenA = IStakingDualRewards(lpStakingPool).rewardsTokenA();
        if(quickswapFactory.getPair(WMATIC, rewardTokenA) == address(0)){
            rewardRateA = 0;
        }else if(rewardTokenA != WMATIC && rewardRateA > 0){ 
          address[] memory route = new address[](2);
          route[0] = rewardTokenA; 
          route[1] = WMATIC;
          uint256[] memory price = quickswapRouter.getAmountsOut(rewardRateA, route);
          rewardRateA = price[price.length - 1];
        }
        
        uint256 rewardRateB = IStakingDualRewards(lpStakingPool).rewardRateB();
        address rewardTokenB = IStakingDualRewards(lpStakingPool).rewardsTokenB();
        if(quickswapFactory.getPair(WMATIC, rewardTokenB) == address(0)){
            rewardRateB = 0;
        } else if(rewardTokenB != WMATIC && rewardRateB > 0){
           address[] memory route = new address[](2); 
           route[0] = rewardTokenB;
           route[1] = WMATIC;
           uint256[] memory price = quickswapRouter.getAmountsOut(rewardRateB, route);
           rewardRateB = price[price.length - 1];
        }
        return rewardRateA.add(rewardRateB);
    }

    function sushiswapRewardRate(address lpPair) internal view returns (uint256) {
        uint256 pid = getPid(lpPair);
        IMiniChefV2.PoolInfo memory poolInfo = miniChef.poolInfo(pid);
        uint256 totalAllocPoint = miniChef.totalAllocPoint();
        uint256 sushiPerSecond = miniChef.sushiPerSecond();
        uint256 sushiRewardRate = sushiPerSecond.mul(poolInfo.allocPoint).div(totalAllocPoint);

        uint256 rewarderTokenRewardRate = complexRewarderTime.rewardPerSecond().mul(poolInfo.allocPoint).div(totalAllocPoint);
        if(rewarderTokenRewardRate > 0){
            address[] memory rewarderTokenToRewardToken = new address[](2); 
            rewarderTokenToRewardToken[0] = WMATIC;
            rewarderTokenToRewardToken[1] = SUSHI;
            
            uint256[] memory price = sushiswapRouter.getAmountsOut(rewarderTokenRewardRate, rewarderTokenToRewardToken);
            return price[price.length - 1].add(sushiRewardRate);
        }
        return sushiRewardRate;
    }

    function getPid(address lpPair) internal view returns(uint256 _pid) {
        bool poolExists = false;
        uint256 poolLength = miniChef.poolLength();
        for(uint256 i = 0; i < poolLength; i++){
            if( miniChef.lpToken(i) == lpPair){
                _pid = i;
                poolExists = true;
                break;
            }
        }
        require(poolExists, "The pool with the given pair token doesn't exist");
        return _pid;
    }
}