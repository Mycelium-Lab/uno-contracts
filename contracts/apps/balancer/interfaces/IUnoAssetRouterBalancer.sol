// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmBalancer as Farm} from './IUnoFarmBalancer.sol'; 
import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 
import '../../../interfaces/IVault.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol';

interface IUnoAssetRouterBalancer {
    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);
    
    event FeeChanged(uint256 previousFee, uint256 newFee);

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);
    function fee() external view returns(uint256);
       
    function WMATIC() external view returns(address);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, address recipient) external returns(uint256 liquidity);
    function depositETH(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, address recipient) external payable returns(uint256 liquidity);
    function depositSingleAsset(address lpPool, address token, uint256 amount, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external returns(uint256 sent, uint256 liquidity);
    function depositSingleETH(address lpPool, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external payable returns(uint256 sentETH, uint256 liquidity);
    function depositLP(address lpPool, uint256 amount, address recipient) external;

    function withdraw(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts, uint256 liquidity);
    function withdrawETH(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts, uint256 liquidity);
    function withdrawSingleAsset(address lpPool, address token, bytes calldata userData, bytes[] calldata swapData, address recipient) external returns(uint256 amountToken, uint256[] memory amounts, uint256 liquidity);
    function withdrawSingleETH(address lpPool, bytes calldata userData, bytes[] calldata swapData, address recipient) external returns(uint256 amountETH, uint256[] memory amounts, uint256 liquidity);
    function withdrawLP(address lpPool, uint256 amount, address recipient) external;

    function distribute(
      address lpPool,
      Farm.SwapInfo[] calldata swapInfos,
      Farm.SwapInfo[] calldata feeSwapInfos,
      address feeTo
    ) external;

    function userStake(address _address, address lpPool) external view returns(uint256);
    function totalDeposits(address lpPool) external view returns (uint256);
    function getTokens(address lpPool) external view returns(IERC20Upgradeable[] memory tokens);

    function setFee(uint256 _fee) external;

    function paused() external view returns(bool);
    function pause() external;
    function unpause() external;

    function upgradeTo(address newImplementation) external;
}
