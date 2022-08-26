// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 
import '../../../interfaces/IVault.sol'; 

interface IUnoAssetRouterBalancer {
    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address lpPool, uint256[] memory amounts, address[] memory tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external returns(uint256 liquidity);
    function withdraw(address lpPool, uint256 amount, uint256[] calldata minAmountsOut, bool withdrawLP, address recipient) external;

    function distribute(
      address lpPool,
      IVault.BatchSwapStep[][] calldata swaps,
      IAsset[][] calldata assets,
      int256[][] calldata limits
    ) external;

    function userStake(address _address, address lpPool) external view returns(uint256);
    function totalDeposits(address lpPool) external view returns (uint256);
    function getTokens(address lpPool) external view returns(IERC20[] memory tokens);

    function paused() external view returns(bool);
    function pause() external;
    function unpause() external;

    function upgradeTo(address newImplementation) external;
}
