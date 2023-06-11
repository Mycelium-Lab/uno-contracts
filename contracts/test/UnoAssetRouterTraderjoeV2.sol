// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../interfaces/IUnoFarm.sol';
import { IUnoFarmTraderjoe as Farm } from "../apps/traderjoe/interfaces/IUnoFarmTraderjoe.sol";
import "../interfaces/IUniswapV2Router.sol";
import "../interfaces/IUnoFarmFactory.sol";
import "../interfaces/IUnoAccessManager.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IWAVAX.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract UnoAssetRouterTraderjoeV2 is
	Initializable,
	PausableUpgradeable,
	UUPSUpgradeable
{
	using SafeERC20Upgradeable for IERC20Upgradeable;

	/**
	 * @dev Contract Variables:
	 * farmFactory - The contract that deploys new Farms and links them to {lpPair}s.
	 * accessManager - Role manager contract.
	 */
	IUnoFarmFactory public farmFactory;
	IUnoAccessManager public accessManager;

	bytes32 private constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
	bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
	bytes32 private ADMIN_ROLE;

	uint256 public fee;

	address public constant WAVAX = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;
	IUniswapV2Router01 public constant TraderjoeRouter = IUniswapV2Router01(0x60aE616a2155Ee3d9A68541Ba4544862310933d4);
    address private constant OneInchRouter = 0x1111111254EEB25477B68fb85Ed929f73A960582;

	uint256 public constant version = 2;

	event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
	event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
	event Distribute(address indexed lpPool, uint256 reward);

	event FeeChanged(uint256 previousFee, uint256 newFee);

	modifier onlyRole(bytes32 role) {
		require(accessManager.hasRole(role, msg.sender), "CALLER_NOT_AUTHORIZED");
		_;
	}

	// ============ Methods ============

	/// @custom:oz-upgrades-unsafe-allow constructor
	constructor() {
		_disableInitializers();
	}

	function initialize(address _accessManager, address _farmFactory) external initializer {
		require(_accessManager != address(0), "BAD_ACCESS_MANAGER");
		require(_farmFactory != address(0), "BAD_FARM_FACTORY");

		__Pausable_init();

		accessManager = IUnoAccessManager(_accessManager);
		ADMIN_ROLE = accessManager.ADMIN_ROLE();
		farmFactory = IUnoFarmFactory(_farmFactory);
	}

	receive() external payable {
		require(msg.sender == WAVAX || msg.sender == address(TraderjoeRouter), "ONLY_ACCEPT_WAVAX"); // only accept ETH via fallback from the WAVAX or router contract
	}

	/**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param amountA  - Token A amount to deposit.
     * @param amountB -  Token B amount to deposit.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentA - Token A amount sent to the farm.
     * @return sentB - Token B amount sent to the farm.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
	function deposit(address lpPair, uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, address recipient) external whenNotPaused returns (uint256 sentA, uint256 sentB, uint256 liquidity){
        require(amountA > 0 && amountB > 0, "NO_TOKENS_SENT");
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();
        IERC20Upgradeable(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20Upgradeable(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        (sentA, sentB, liquidity) = _addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, address(farm));
        farm.deposit(liquidity, recipient);

        emit Deposit(lpPair, msg.sender, recipient, liquidity); 
    }

	/**
     * @dev Autoconverts AVAX into WAVAX and deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpStakingPool} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param amountToken  - Token amount to deposit.
     * @param amountTokenMin - Bounds the extent to which the TOKEN/WAVAX price can go up before the transaction reverts.
     * @param amountETHMin - Bounds the extent to which the WAVAX/TOKEN price can go up before the transaction reverts.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentToken - Token amount sent to the farm.
     * @return sentETH - WAVAX amount sent to the farm.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositETH(address lpPair, uint256 amountToken, uint256 amountTokenMin, uint256 amountETHMin, address recipient) external payable whenNotPaused returns(uint256 sentToken, uint256 sentETH, uint256 liquidity){
        require(msg.value > 0, "NO_AVAX_SENT");
        require(amountToken > 0, "NO_TOKEN_SENT");
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();
        if (tokenA == WAVAX) {
            IERC20Upgradeable(tokenB).safeTransferFrom(msg.sender, address(this), amountToken);
            (sentToken, sentETH, liquidity) = _addLiquidityETH(tokenB, amountToken, amountTokenMin, amountETHMin, address(farm));
        } else if (tokenB == WAVAX) {
            IERC20Upgradeable(tokenA).safeTransferFrom(msg.sender, address(this), amountToken);
            (sentToken, sentETH, liquidity) = _addLiquidityETH(tokenA, amountToken, amountTokenMin, amountETHMin, address(farm));
        } else {
            revert("NOT_WAVAX_POOL");
        }
        farm.deposit(liquidity, recipient);

        emit Deposit(lpPair, msg.sender, recipient, liquidity);
    }

	/**
     * @dev Deposits single token in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair}, swaps {token} for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param token  - Address of a token to enter the pool.
     * @param amount - Amount of token sent.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param recipient - Address which will receive the deposit.
     
     * @return sent - Total {token} amount sent to the farm. NOTE: Returns dust left from swap in {token}, but if A/B amounts are not correct also returns dust in pool's tokens.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleAsset(address lpPair, address token, uint256 amount, bytes[2] calldata swapData, uint256 amountAMin, uint256 amountBMin, address recipient) external whenNotPaused returns(uint256 sent, uint256 liquidity){
        require(amount > 0, "NO_TOKEN_SENT");
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        IERC20Upgradeable(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20Upgradeable(token).approve(OneInchRouter, amount);

        sent = amount;
        uint256 amountA;
        uint256 amountB;
        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();

        if (tokenA != token) {
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[0], tokenA);
            amount -= spentAmount;
            amountA = returnAmount;
        }
        if (tokenB != token) {
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[1], tokenB);
            amount -= spentAmount;
            amountB = returnAmount;
        }

        if (tokenA == token) {
            amountA = amount;
        } else if (tokenB == token) {
            amountB = amount;
        } else if(amount > 0) {
            sent -= amount;
            IERC20Upgradeable(token).safeTransfer(msg.sender, amount);
        }

        require(amountA > 0 && amountB > 0, "NO_TOKENS_SENT");
        (,,liquidity) = _addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, address(farm));
        farm.deposit(liquidity, recipient);
        
        emit Deposit(lpPair, msg.sender, recipient, liquidity);
    }
     
    /**
     * @dev Deposits single AVAX in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair}, swaps AVAX for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param swapData - Parameter with which 1inch router is being called with. NOTE: Use WAVAX as toToken.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentETH - Total AVAX amount sent to the farm. NOTE: Returns dust left from swap in AVAX, but if A/B amount are not correct also returns dust in pool's tokens.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleETH(address lpPair, bytes[2] calldata swapData, uint256 amountAMin, uint256 amountBMin, address recipient) external payable whenNotPaused returns(uint256 sentETH, uint256 liquidity){
        require(msg.value > 0, "NO_AVAX_SENT");
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        uint256 amount = msg.value;
        IWAVAX(WAVAX).deposit{value: amount}();
        IERC20Upgradeable(WAVAX).approve(OneInchRouter, amount);

        sentETH = amount;
        uint256 amountA;
        uint256 amountB;
        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();

        if (tokenA != WAVAX) {
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[0], tokenA);
            amount -= spentAmount;
            amountA = returnAmount;
        }
        if (tokenB != WAVAX) {
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[1], tokenB);
            amount -= spentAmount;
            amountB = returnAmount;
        }

        if (tokenA == WAVAX) {
            amountA = amount;
        } else if (tokenB == WAVAX) {
            amountB = amount;
        } else if (amount > 0) {
            sentETH -= amount;
            IWAVAX(WAVAX).withdraw(amount);
            payable(msg.sender).transfer(amount);
        }

        require(amountA > 0 && amountB > 0, "NO_TOKENS_SENT");
        (,,liquidity) = _addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, address(farm));
        farm.deposit(liquidity, recipient);

        emit Deposit(lpPair, msg.sender, recipient, liquidity);
    }

	/**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param amount - LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     */
    function depositLP(address lpPair, uint256 amount, address recipient) external whenNotPaused{
        require(amount > 0, "NO_TOKEN_SENT");
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(farm), amount);
        farm.deposit(amount, recipient);

        emit Deposit(lpPair, msg.sender, recipient, amount); 
    }

    /** 
     * @dev Withdraws a pair of tokens from the given pool. Emits a {Withdraw} event.
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param amountAMin - The minimum amount of tokenA that must be received for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be received for the transaction not to revert.
     * @param recipient - The address which will receive tokens.

     * @return amountA - Token A amount sent to the {recipient}
     * @return amountB - Token B amount sent to the {recipient}
     */ 
    function withdraw(address lpPair, uint256 amount, uint256 amountAMin, uint256 amountBMin, address recipient) external returns(uint256 amountA, uint256 amountB){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        farm.withdraw(amount, msg.sender, address(this));
        (amountA, amountB) = _removeLiquidity(lpPair, farm.tokenA(), farm.tokenB(), amount, amountAMin, amountBMin, recipient);
        
        emit Withdraw(lpPair, msg.sender, recipient, amount);  
    }

    /** 
     * @dev Autoconverts WAVAX into AVAX and withdraws tokens from the pool. Emits a {Withdraw} event.
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param amountTokenMin - The minimum amount of token that must be received for the transaction not to revert.
     * @param amountETHMin - The minimum amount of AVAX that must be received for the transaction not to revert.
     * @param recipient - The address which will receive tokens.

     * @return amountToken - Token amount sent to the {recipient}.
     * @return amountETH - AVAX amount sent to the {recipient}.
     */ 
    function withdrawETH(address lpPair, uint256 amount, uint256 amountTokenMin, uint256 amountETHMin, address recipient) external returns(uint256 amountToken, uint256 amountETH){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();

        farm.withdraw(amount, msg.sender, address(this));
        if (tokenA == WAVAX) {
            (amountToken, amountETH) = _removeLiquidityETH(lpPair, tokenB, amount, amountTokenMin, amountETHMin, recipient);
        } else if (tokenB == WAVAX) {
            (amountToken, amountETH) = _removeLiquidityETH(lpPair, tokenA, amount, amountTokenMin, amountETHMin, recipient);
        } else {
            revert("NOT_WAVAX_POOL");
        }

        emit Withdraw(lpPair, msg.sender, recipient, amount);
    }

    /**
     * @dev Withdraws single token from the given pool. Emits a {Withdraw} event. Note: If there are any tokens left to be withdrawn after swaps they will be sent to the {{recipient}} in a respective token (not in {token}).
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param token  - Address of a token to exit the pool with.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return amountToken - {token} amount sent to the {recipient}.
     * @return amountA - Token A dust sent to the {recipient}.
     * @return amountB - Token B dust sent to the {recipient}.
     */
    function withdrawSingleAsset(address lpPair, uint256 amount, address token, bytes[2] calldata swapData, address recipient) external returns(uint256 amountToken, uint256 amountA, uint256 amountB){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        farm.withdraw(amount, msg.sender, address(this));

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();
        (amountA, amountB) = _removeLiquidity(lpPair, tokenA, tokenB, amount, 0, 0, address(this));

        if (tokenA != token) {
            IERC20Upgradeable(tokenA).approve(OneInchRouter, amountA);
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[0], token);
            amountToken += returnAmount;

            amountA = amountA - spentAmount;
            IERC20Upgradeable(tokenA).safeTransfer(recipient, amountA);
        } else {
            amountToken += amountA;
            amountA = 0;
        }

        if (tokenB != token) {
            IERC20Upgradeable(tokenB).approve(OneInchRouter, amountB);
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[1], token);
            amountToken += returnAmount;

            amountB = amountB - spentAmount;
            IERC20Upgradeable(tokenB).safeTransfer(recipient, amountB);
        } else {
            amountToken += amountB;
            amountB = 0;
        }

        IERC20Upgradeable(token).safeTransfer(recipient, amountToken);

        emit Withdraw(lpPair, msg.sender, recipient, amount);
    }
     
    /**
     * @dev Withdraws single AVAX from the given pool. Emits a {Withdraw} event. Note: If there are any tokens left to be withdrawn after swaps they will be sent to the {{recipient}} in a respective token (not in AVAX).
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return amountETH - AVAX amount sent to the {recipient}.
     * @return amountA - Token A dust sent to the {recipient}.
     * @return amountB - Token B dust sent to the {recipient}.
     */
    function withdrawSingleETH(address lpPair, uint256 amount, bytes[2] calldata swapData, address recipient) external returns(uint256 amountETH, uint256 amountA, uint256 amountB){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        farm.withdraw(amount, msg.sender, address(this));

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();
        (amountA, amountB) = _removeLiquidity(lpPair, tokenA, tokenB, amount, 0, 0, address(this));

        if (tokenA != WAVAX) {
            IERC20Upgradeable(tokenA).approve(OneInchRouter, amountA);
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[0], WAVAX);
            amountETH += returnAmount;

            amountA = amountA - spentAmount;
            IERC20Upgradeable(tokenA).safeTransfer(recipient, amountA);
        } else {
            amountETH += amountA;
            amountA = 0;
        }

        if (tokenB != WAVAX) {
            IERC20Upgradeable(tokenB).approve(OneInchRouter, amountB);
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[1], WAVAX);
            amountETH += returnAmount;

            amountB = amountB - spentAmount;
            IERC20Upgradeable(tokenB).safeTransfer(recipient, amountB);
        } else {
            amountETH += amountB;
            amountB = 0;
        }

        IWAVAX(WAVAX).withdraw(amountETH);
        payable(recipient).transfer(amountETH);

        emit Withdraw(lpPair, msg.sender, recipient, amount);
    }

    /** 
     * @dev Withdraws LP tokens from the given pool. Emits a {Withdraw} event.
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param recipient - The address which will receive tokens.
     */ 
    function withdrawLP(address lpPair, uint256 amount, address recipient) external {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');
        
        farm.withdraw(amount, msg.sender, recipient);
        emit Withdraw(lpPair, msg.sender, recipient, amount);  
    }

	/**
	 * @dev Distributes tokens between users.
	 * @param lpPair - LP pool to distribute tokens in.
	 * @param swapInfos - Arrays of structs with token arrays describing swap routes (rewardTokenToTokenA, rewardTokenToTokenB, rewarderTokenToTokenA, rewarderTokenToTokenB) and minimum amounts of output tokens that must be received for the transaction not to revert.
	 * @param feeSwapInfo - Struct with token arrays describing swap route (rewardTokenToFeeToken, rewarderTokenToFeeToken) and minimum amounts of output tokens that must be received for the transaction not to revert.
	 * @param feeTo - Address to collect fees to.
	 *
	 * Note: This function can only be called by the distributor.
	 */
	function distribute(
		address lpPair,
		Farm.SwapInfo[4] calldata swapInfos,
		Farm.SwapInfo[2] calldata feeSwapInfo,
		address feeTo
	) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) {
		Farm farm = Farm(farmFactory.Farms(lpPair));
		require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

		uint256 reward = farm.distribute(swapInfos, feeSwapInfo, IUnoFarm.FeeInfo(feeTo, fee));
		emit Distribute(lpPair, reward);
	}

	/**
     * @dev Returns tokens staked by the {_address} for the given {lpPair}.
     * @param _address - The address to check stakes for.
     * @param lpPair - LP pool to check stakes in.

     * @return stakeLP - Total user stake(in LP tokens).
     * @return stakeA - Token A stake.
     * @return stakeB - Token B stake.
     */
	function userStake(address _address, address lpPair) external view returns (uint256 stakeLP, uint256 stakeA, uint256 stakeB) {
		Farm farm = Farm(farmFactory.Farms(lpPair));
		if (farm != Farm(address(0))) {
			stakeLP = farm.userBalance(_address);
			(stakeA, stakeB) = _getTokenStake(lpPair, stakeLP);
		}
	}

	/**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPair - LP pool to check total deposits in.

     * @return totalDepositsLP - Total deposits (in LP tokens).
     * @return totalDepositsA - Token A deposits.
     * @return totalDepositsB - Token B deposits.
     */
	function totalDeposits(address lpPair) external view returns (uint256 totalDepositsLP, uint256 totalDepositsA, uint256 totalDepositsB){
		Farm farm = Farm(farmFactory.Farms(lpPair));
		if (farm != Farm(address(0))) {
			totalDepositsLP = farm.getTotalDeposits();
			(totalDepositsA, totalDepositsB) = _getTokenStake(lpPair, totalDepositsLP);
		}
	}

	/**
     * @dev Returns addresses of tokens in {lpPair}.
     * @param lpPair - LP pair to check tokens in.

     * @return tokens - Tokens addresses.
     */
	function getTokens(address lpPair) external view returns (IERC20Upgradeable[] memory tokens) {
		tokens = new IERC20Upgradeable[](2);
		tokens[0] = IERC20Upgradeable(IUniswapV2Pair(lpPair).token0());
		tokens[1] = IERC20Upgradeable(IUniswapV2Pair(lpPair).token1());
	}

	/**
     * @dev Deposits assets to router & refunds dust.
     */ 
    function _addLiquidity(
        address tokenA,
        address tokenB, 
        uint256 amountA, 
        uint256 amountB, 
        uint256 amountAMin, 
        uint256 amountBMin, 
        address farm
    ) internal returns(uint256 sentA, uint256 sentB, uint256 liquidity){
        IERC20Upgradeable(tokenA).approve(address(TraderjoeRouter), amountA);
        IERC20Upgradeable(tokenB).approve(address(TraderjoeRouter), amountB);

        (sentA, sentB, liquidity) = TraderjoeRouter.addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, farm, block.timestamp);
        // Refund dust
        IERC20Upgradeable(tokenA).safeTransfer(msg.sender, amountA - sentA);
		IERC20Upgradeable(tokenB).safeTransfer(msg.sender, amountB - sentB);
    }

    /**
     * @dev Deposits assets to router & refunds dust.
     */ 
    function _addLiquidityETH(
        address token,
        uint256 amount, 
        uint256 amountTokenMin, 
        uint256 amountETHMin, 
        address farm
    ) internal returns(uint256 sentToken, uint256 sentETH, uint256 liquidity){
        IERC20Upgradeable(token).approve(address(TraderjoeRouter), amount);

        (sentToken, sentETH, liquidity) = TraderjoeRouter.addLiquidityAVAX{value: msg.value}(token, amount, amountTokenMin, amountETHMin, farm, block.timestamp);
        // Refund dust
        IERC20Upgradeable(token).safeTransfer(msg.sender, amount - sentToken);
        payable(msg.sender).transfer(msg.value - sentETH);
    }
    
    /**
     * @dev Withdraws assets from router.
     */ 
    function _removeLiquidity(
        address lpPair,
        address tokenA,
        address tokenB, 
        uint256 amount, 
        uint256 amountAMin, 
        uint256 amountBMin, 
        address recipient
    ) internal returns(uint256 amountA, uint256 amountB){
        IERC20Upgradeable(lpPair).approve(address(TraderjoeRouter), amount);
        (amountA, amountB) = TraderjoeRouter.removeLiquidity(tokenA, tokenB, amount, amountAMin, amountBMin, recipient, block.timestamp);
    }

    /**
     * @dev Withdraws assets from router.
     */ 
    function _removeLiquidityETH(
        address lpPair,
        address token,
        uint256 amount, 
        uint256 amountTokenMin, 
        uint256 amountETHMin, 
        address recipient
    ) internal returns(uint256 amountToken, uint256 amountETH){
        IERC20Upgradeable(lpPair).approve(address(TraderjoeRouter), amount);
        (amountToken, amountETH) = TraderjoeRouter.removeLiquidityAVAX(token, amount, amountTokenMin, amountETHMin, recipient, block.timestamp);
    }

    /**
     * @dev Swaps assets using 1inch exchange.
     */  
    function _swap(bytes calldata swapData, address toToken) internal returns(uint256 returnAmount, uint256 spentAmount){
        uint256 balanceBefore = IERC20Upgradeable(toToken).balanceOf(address(this));
        (bool success, bytes memory data) = OneInchRouter.call(swapData);
        require(success, "SWAP_NOT_SUCCESSFUL");

        (returnAmount, spentAmount) = abi.decode(data, (uint256, uint256));
        //checks if all {{toToken}}s from swap were transfered to this address
        uint256 balanceAfter = IERC20Upgradeable(toToken).balanceOf(address(this));
        require(balanceAfter - balanceBefore == returnAmount, "BAD_RETURN_AMOUNT");
    }

	/**
     * @dev Converts LP tokens to normal tokens, value(amountA) == value(amountB) == 0.5*amountLP
     * @param lpPair - LP pair for conversion.
     * @param amountLP - Amount of LP tokens to convert.

     * @return amountA - Token A amount.
     * @return amountB - Token B amount.
     */
	function _getTokenStake(address lpPair, uint256 amountLP) internal view returns (uint256 amountA, uint256 amountB) {
		uint256 totalSupply = IERC20Upgradeable(lpPair).totalSupply();
		amountA = (amountLP * IERC20Upgradeable(IUniswapV2Pair(lpPair).token0()).balanceOf(lpPair)) / totalSupply;
		amountB = (amountLP * IERC20Upgradeable(IUniswapV2Pair(lpPair).token1()).balanceOf(lpPair)) / totalSupply;
	}

	/**
	 * @dev Change fee amount.
	 * @param _fee -New fee to collect from farms. [10^18 == 100%]
	 *
	 * Note: This function can only be called by ADMIN_ROLE.
	 */
	function setFee(uint256 _fee) external onlyRole(ADMIN_ROLE) {
		require(_fee <= 1 ether, "BAD_FEE");
		if (fee != _fee) {
			emit FeeChanged(fee, _fee);
			fee = _fee;
		}
	}

	function pause() external onlyRole(PAUSER_ROLE) {
		_pause();
	}

	function unpause() external onlyRole(PAUSER_ROLE) {
		_unpause();
	}

	function _authorizeUpgrade(address) internal override onlyRole(ADMIN_ROLE) {}
}