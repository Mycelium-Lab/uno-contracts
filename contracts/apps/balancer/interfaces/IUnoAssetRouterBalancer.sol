// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 
import '../../../interfaces/MerkleOrchard.sol'; 
import '../../../interfaces/IVault.sol'; 

interface IUnoAssetRouterBalancer {
    event Deposit(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(uint256[] memory amounts, address[] memory tokens, uint256 amountLP, address lpPair, address recipient) external returns(uint256 liquidity);
    function withdraw(address lpPair, uint256 amount, bool withdrawLP, address recipient) external;

    function setExpectedReward(address lpPair, uint256 expectedReward, uint256 expectedRewardBlock) external;
    function distribute(
        address lpPair,
        MerkleOrchard.Claim[] memory claims,
        IERC20[] memory rewardTokens,
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        IVault.FundManagement[] memory funds,
        int256[][] memory limits
    ) external;

   
    function userStake(address _address, address lpPair) external view returns (uint256);
    function totalDeposits(address lpPair) external view returns (uint256);

    function paused() external view returns(bool);
    function pause() external;
    function unpause() external;

    function upgradeTo(address newImplementation) external;
}
