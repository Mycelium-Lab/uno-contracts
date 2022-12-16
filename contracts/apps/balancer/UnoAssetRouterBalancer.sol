// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmBalancer as Farm} from './interfaces/IUnoFarmBalancer.sol'; 
import '../../interfaces/IUnoFarmFactory.sol';
import '../../interfaces/IUnoAccessManager.sol'; 
import '../../interfaces/IVault.sol'; 
import "../../interfaces/IBasePool.sol";
import '../../interfaces/IWMATIC.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract UnoAssetRouterBalancer is Initializable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {lpPool}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;

    bytes32 private constant DISTRIBUTOR_ROLE = keccak256('DISTRIBUTOR_ROLE');
    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

    IVault constant private Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    uint256 public fee;

    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
    address private constant oneInchRouter = 0x1111111254EEB25477B68fb85Ed929f73A960582;

    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    event FeeChanged(uint256 previousFee, uint256 newFee);

    modifier onlyRole(bytes32 role){
        require(accessManager.hasRole(role, msg.sender), 'CALLER_NOT_AUTHORIZED');
        _;
    }

    // ============ Methods ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _accessManager, address _farmFactory) external initializer{
        require (_accessManager != address(0), 'BAD_ACCESS_MANAGER');
        require (_farmFactory != address(0), 'BAD_FARM_FACTORY');

        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);
    }

    receive() external payable {
        require(msg.sender == WMATIC, 'ONLY_ACCEPT_WMATIC'); // only accept ETH via fallback from the WMATIC contract
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param amountLP - Additional amount of LP tokens to deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external whenNotPaused returns(uint256 liquidity){
        require (amounts.length == tokens.length, 'AMOUNTS_AND_TOKENS_LENGTHS_NOT_MATCH');
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(farm), amounts[i]);
            }
        }
        if(amountLP > 0){
            IERC20Upgradeable(lpPool).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        
        liquidity = farm.deposit(amounts, tokens, minAmountLP, amountLP, recipient);
        emit Deposit(lpPool, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Autoconverts MATIC into WMATIC and deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param amountLP - Additional amount of LP tokens to deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositETH(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external payable whenNotPaused returns(uint256 liquidity){
        require(msg.value > 0, "NO_MATIC_SENT");
        require (amounts.length == tokens.length, 'AMOUNTS_AND_TOKENS_LENGTHS_NOT_MATCH');

        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        bool WMATICInTokens;
        IWMATIC(WMATIC).deposit{value: msg.value}();
        IERC20Upgradeable(WMATIC).safeTransfer(address(farm), msg.value);
        for (uint256 i = 0; i < tokens.length; i++) {
            if(tokens[i] != WMATIC){
                if(amounts[i] > 0){
                    IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(farm), amounts[i]);
                }
                continue;
            }
            amounts[i] = msg.value;
            WMATICInTokens = true;
        }
        require(WMATICInTokens, "NO_WMATIC_IN_TOKENS");

        if(amountLP > 0){
            IERC20Upgradeable(lpPool).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        
        liquidity = farm.deposit(amounts, tokens, minAmountLP, amountLP, recipient);
        emit Deposit(lpPool, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Deposits single token in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool}, swaps {token} for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param token  - Address of a token to enter the pool.
     * @param amount - Amount of token sent.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sent - Total {token} amount sent to the farm. 
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleAsset(address lpPool, address token, uint256 amount, bytes[] calldata swapData, address[] calldata tokens, uint256 minAmountLP, address recipient) external whenNotPaused returns(uint256 sent, uint256 liquidity){
        require(amount > 0, "NO_TOKEN_SENT");
        require (swapData.length == tokens.length, 'SWAPDATA_AND_TOKENS_LENGHTS_NOT_MATCH');

        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        IERC20Upgradeable(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20Upgradeable(token).approve(oneInchRouter, amount);

        sent = amount;
        uint256[] memory amounts = new uint256[](tokens.length);
        {
        int256 tokenIndex = -1;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) {
                tokenIndex = int(i);
                continue;
            }
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[i]);
            if (returnAmount > 0) {
                amounts[i] = returnAmount;
                IERC20Upgradeable(tokens[i]).safeTransfer(address(farm), returnAmount);
            }
            amount -= spentAmount;
        }

        if (tokenIndex != -1) {
            amounts[uint256(tokenIndex)] = amount;
            IERC20Upgradeable(token).safeTransfer(address(farm), amount);
        } else if (amount > 0) {
            sent -= amount;
            IERC20Upgradeable(token).safeTransfer(msg.sender, amount);
        }
        }

        liquidity = farm.deposit(amounts, tokens, minAmountLP, 0, recipient);
        emit Deposit(lpPool, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits single MATIC in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool}, swaps MATIC for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentETH - Total MATIC amount sent to the farm. 
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleETH(address lpPool, bytes[] calldata swapData, address[] calldata tokens, uint256 minAmountLP, address recipient) external payable whenNotPaused returns(uint256 sentETH, uint256 liquidity){
        require(msg.value > 0, "NO_MATIC_SENT");
        require (swapData.length == tokens.length, 'SWAPDATA_AND_TOKENS_LENGHTS_NOT_MATCH');

        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        uint256 amount = msg.value;
        sentETH = amount;
        IWMATIC(WMATIC).deposit{value: amount}();
        IERC20Upgradeable(WMATIC).approve(oneInchRouter, amount);

        int256 wmaticIndex = -1;
        uint256[] memory amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == WMATIC) {
                wmaticIndex = int(i);
                continue;
            }
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[i]);
            if (returnAmount > 0) {
                amounts[i] = returnAmount;
                IERC20Upgradeable(tokens[i]).safeTransfer(address(farm), returnAmount);
            }
            amount -= spentAmount;
        }

        if (wmaticIndex != -1) {
            amounts[uint(wmaticIndex)] = amount;
            IERC20Upgradeable(WMATIC).safeTransfer(address(farm), amount);
        } else if (amount > 0){
            sentETH -= amount;
            IWMATIC(WMATIC).withdraw(amount);
            payable(msg.sender).transfer(amount);
        }

        liquidity = farm.deposit(amounts, tokens, minAmountLP, 0, recipient);
        emit Deposit(lpPool, msg.sender, recipient, liquidity);
    }

    /** 
     * @dev Withdraws tokens from the given pool. 
     * @param lpPool - LP pool to withdraw from.
     * @param userData - If withdrawLP provide LP amount to withdraw, else use Balancer pool exit userData.
     * @param minAmountsOut - Minimum token amounts the user will receive.
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}.
     * @return liquidity - Total liquidity sent to the user (in lpTokens).
     */ 
    function withdraw(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, bool withdrawLP, address recipient) external returns(uint256[] memory amounts, uint256 liquidity){ 
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        (amounts, liquidity) = farm.withdraw(userData, minAmountsOut, withdrawLP, msg.sender, recipient);
        emit Withdraw(lpPool, msg.sender, recipient, liquidity);
    }

    /** 
     * @dev Autoconverts WMATIC into MATIC and withdraws tokens from the given pool. 
     * @param lpPool - LP pool to withdraw from.
     * @param userData -  Balancer pool exit userData.
     * @param minAmountsOut - Minimum token amounts the user will receive.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}.
     * @return liquidity - Total liquidity sent to the user (in lpTokens).
     */ 
    function withdrawETH(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts, uint256 liquidity){ 
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        (amounts, liquidity) = farm.withdraw(userData, minAmountsOut, false, msg.sender, address(this));

        IERC20[] memory tokens = getTokens(lpPool);
        for (uint256 i = 0; i < tokens.length; i++) {
            if (amounts[i] == 0){
                continue;
            }
            if (address(tokens[i]) != WMATIC) {
                IERC20Upgradeable(address(tokens[i])).safeTransfer(recipient, amounts[i]);
                continue;
            }
            IWMATIC(WMATIC).withdraw(amounts[i]);
            payable(recipient).transfer(amounts[i]);
        }
        emit Withdraw(lpPool, msg.sender, recipient, liquidity);  
    }

    /**
     * @dev Distributes tokens between users for a single {Farms[lpPool]}.
     * @param lpPool - The pool to distribute. 
     * @param swapInfos - The data used to swap reward tokens for the needed tokens.
     * @param feeSwapInfos - The data used to swap reward tokens for fees.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address lpPool,
        Farm.SwapInfo[] calldata swapInfos,
        Farm.SwapInfo[] calldata feeSwapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)), 'FARM_NOT_EXISTS');

        uint256 reward = farm.distribute(swapInfos, feeSwapInfos, Farm.FeeInfo(feeTo, fee));
        emit Distribute(lpPool, reward);
    }

    /**
     * @dev Returns LP tokens staked by the {_address} for the given {lpPool}.
     * @param _address - The address to check stakes for.
     * @param lpPool - LP pool to check stakes in.

     * @return Total user stake(in LP tokens).
     */
   function userStake(address _address, address lpPool) external view returns(uint256){
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.userBalance(_address);
        }
        return 0;
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPool - LP pool to check total deposits in.

     * @return Total deposits (in LP tokens).
     */
    function totalDeposits(address lpPool) external view returns (uint256) {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.getTotalDeposits();
        }
        return 0;
    }

    /**
     * @dev Returns addresses of tokens in {lpPool}.
     * @param lpPool - LP pool to check tokens in.

     * @return tokens - Token addresses.
     */  
    function getTokens(address lpPool) public view returns(IERC20[] memory tokens){
        bytes32 poolId = IBasePool(lpPool).getPoolId();
        (tokens, , ) = Vault.getPoolTokens(poolId);
    }

    /**
     * @dev Swaps assets using 1inch exchange.
     */  
    function _swap(bytes calldata swapData) internal returns(uint256 returnAmount, uint256 spentAmount){
        (bool success, bytes memory data) = oneInchRouter.call(swapData);
        require(success, "SWAP_NOT_SUCCESSFUL");
        (returnAmount, spentAmount) = abi.decode(data, (uint256, uint256));
    }

    /**
     * @dev Change fee amount.
     * @param _fee -New fee to collect from farms. [10^18 == 100%]
     *
     * Note: This function can only be called by ADMIN_ROLE.
     */ 
    function setFee(uint256 _fee) external onlyRole(accessManager.ADMIN_ROLE()){
        require (_fee <= 1 ether, "BAD_FEE");
        if(fee != _fee){
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

    function _authorizeUpgrade(address) internal override onlyRole(accessManager.ADMIN_ROLE()) {

    }
}
