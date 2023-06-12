// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';
import { IUnoFarmTrisolarisStable as Farm } from "../interfaces/IUnoFarmTrisolarisStable.sol";
import "../../../interfaces/IUnoFarmFactory.sol";
import "../../../interfaces/IUnoAccessManager.sol";
import "../../../interfaces/ISwap.sol";
import '../../../interfaces/IWETH.sol';
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract UnoAssetRouterTrisolarisStableV2 is Initializable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {swap}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;

    bytes32 private ADMIN_ROLE;
    bytes32 private constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public fee;

    address public constant WETH = 0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB;
    address private constant OneInchRouter = 0x1111111254EEB25477B68fb85Ed929f73A960582;

    uint256 public constant version = 2;

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

    function initialize(address _accessManager, address _farmFactory) external initializer {
        require (_accessManager != address(0), 'BAD_ACCESS_MANAGER');
        require (_farmFactory != address(0), 'BAD_FARM_FACTORY');

        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);

        ADMIN_ROLE = accessManager.ADMIN_ROLE();
    }

    receive() external payable {
        require(msg.sender == WETH, 'ONLY_ACCEPT_WETH'); // only accept ETH via fallback from the WETH contract
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {swap} and deposits tokens in it. Emits a {Deposit} event.
     * @param swap - Address of the Swap contract.
     * @param amounts - Amounts of tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {amounts} deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(address swap, uint256[] memory amounts, uint256 minAmountLP, address recipient) external whenNotPaused returns (uint256 liquidity) {
        IERC20[] memory tokens = getTokens(swap);
        require(amounts.length == tokens.length, "BAD_AMOUNTS_LENGTH");
        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm == Farm(address(0))) {
            farm = Farm(farmFactory.createFarm(swap));
        }

        for (uint256 i = 0; i < amounts.length; i++) { 
            if (amounts[i] > 0) {
                IERC20Upgradeable(farm.tokens(i)).safeTransferFrom(msg.sender, address(this), amounts[i]); 
            }
        }
 
        liquidity = _addLiquidity(swap, amounts, tokens, minAmountLP, farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(swap, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Autoconverts ETH into WETH and deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {swap} and deposits tokens in it.
     * @param swap - Address of the Swap contract.
     * @param amounts - Amounts of tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {amounts} deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositETH(address swap, uint256[] memory amounts, uint256 minAmountLP, address recipient) external payable whenNotPaused returns(uint256 liquidity){
        require(msg.value > 0, "NO_ETH_SENT");
        IERC20[] memory tokens = getTokens(swap);
        require(amounts.length == tokens.length, "BAD_AMOUNTS_LENGTH");

        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm == Farm(address(0))) {
            farm = Farm(farmFactory.createFarm(swap));
        }

        bool WETHInTokens;
        IWETH(WETH).deposit{value: msg.value}();
        for (uint256 i = 0; i < amounts.length; i++) {
            address token = farm.tokens(i);
            if(token == WETH){
                amounts[i] = msg.value;
                WETHInTokens = true;
                continue;
            }
            if(amounts[i] > 0){
                IERC20Upgradeable(token).safeTransferFrom(msg.sender, address(this), amounts[i]);
            }
        }
        require(WETHInTokens, "NOT_WETH_POOL");
        
        liquidity = _addLiquidity(swap, amounts, tokens, minAmountLP, farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(swap, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Deposits single token in the given pool. Creates new Farm contract if there isn't one deployed for the {swap}, swaps {token} for pool tokens and deposits them. Emits a {Deposit} event.
     * @param swap - Address of the pool to deposit tokens in.
     * @param token  - Address of a token to enter the pool.
     * @param amount - Amount of token sent.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sent - Total {token} amount sent to the farm. 
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleAsset(address swap, address token, uint256 amount, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external whenNotPaused returns(uint256 sent, uint256 liquidity){
        require (amount > 0, "NO_TOKEN_SENT");
        IERC20[] memory tokens = getTokens(swap);
        require (swapData.length == tokens.length, 'BAD_SWAP_DATA_LENGTH');
        
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(swap));
        }

        IERC20Upgradeable(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20Upgradeable(token).approve(OneInchRouter, amount);

        uint256[] memory amounts = new uint256[](tokens.length);
        {
        sent = amount;
        int256 tokenIndex = -1;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (address(tokens[i]) == token) {
                tokenIndex = int(i);
                continue;
            }
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[i], address(tokens[i]));
            amounts[i] = returnAmount;
            amount -= spentAmount;
        }

        if (tokenIndex != -1) {
            amounts[uint256(tokenIndex)] = amount;
        } else if (amount > 0) {
            sent -= amount;
            IERC20Upgradeable(token).safeTransfer(msg.sender, amount);
        }
        }

        liquidity = _addLiquidity(swap, amounts, tokens, minAmountLP, farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(swap, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits single ETH in the given pool. Creates new Farm contract if there isn't one deployed for the {swap}, swaps ETH for pool tokens and deposits them. Emits a {Deposit} event.
     * @param swap - Address of the pool to deposit tokens in.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentETH - Total ETH amount sent to the farm. 
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositSingleETH(address swap, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external payable whenNotPaused returns(uint256 sentETH, uint256 liquidity){
        require (msg.value > 0, "NO_ETH_SENT");
        IERC20[] memory tokens = getTokens(swap);
        require (swapData.length == tokens.length, 'BAD_SWAP_DATA_LENGTH');
        
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(swap));
        }

        uint256 amount = msg.value;
        IWETH(WETH).deposit{value: amount}();
        IERC20Upgradeable(WETH).approve(OneInchRouter, amount);

        uint256[] memory amounts = new uint256[](tokens.length);
        {
        sentETH = amount;
        int256 wethIndex = -1;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (address(tokens[i]) == WETH) {
                wethIndex = int(i);
                continue;
            }
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[i], address(tokens[i]));
            if (returnAmount > 0) {
                amounts[i] = returnAmount;
            }
            amount -= spentAmount;
        }

        if (wethIndex != -1) {
            amounts[uint(wethIndex)] = amount;
        } else if (amount > 0){
            sentETH -= amount;
            IWETH(WETH).withdraw(amount);
            payable(msg.sender).transfer(amount);
        }
        }

        liquidity = _addLiquidity(swap, amounts, tokens, minAmountLP, farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(swap, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it. Emits a {Deposit} event.
     * @param swap - Address of the pool to deposit tokens in.
     * @param amount - LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     */
    function depositLP(address swap, uint256 amount, address recipient) external whenNotPaused{
        require(amount > 0, "NO_TOKEN_SENT");
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(swap));
        }

        IERC20Upgradeable(farm.lpPool()).safeTransferFrom(msg.sender, address(farm), amount);
        farm.deposit(amount, recipient);

        emit Deposit(swap, msg.sender, recipient, amount); 
    }

    /** 
     * @dev Withdraws tokens from the given pool. Emits a {Withdraw} event.
     * @param swap - Address of the Swap contract.
     * @param amount - Amounts of LP tokens to withdraw.
     * @param minAmounts - Minimum amounts of tokens sent to {recipient}.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to {recipient}, an array of zeros if withdrawLP == false.
     */
    function withdraw(
        address swap,
        uint256 amount,
        uint256[] calldata minAmounts,
        address recipient
    ) external returns (uint256[] memory amounts) {
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        farm.withdraw(amount, msg.sender, address(this));
        amounts = _removeLiquidity(swap, amount, _convertToAddressArray(getTokens(swap)), minAmounts, recipient);

        emit Withdraw(swap, msg.sender, recipient, amount);
    }

        /** 
     * @dev Autoconverts WETH into ETH and withdraws tokens from the given pool. 
     * @param swap - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param minAmounts - Minimum token amounts the user will receive.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}
     */ 
    function withdrawETH(address swap, uint256 amount, uint256[] calldata minAmounts, address recipient) external returns(uint256[] memory amounts){ 
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        address[] memory tokens = _convertToAddressArray(getTokens(swap));
        farm.withdraw(amount, msg.sender, address(this));
        amounts = _removeLiquidity(swap, amount, tokens, minAmounts, address(this));

        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] != WETH) {
                IERC20Upgradeable(tokens[i]).safeTransfer(recipient, amounts[i]);
                continue;
            }
            IWETH(WETH).withdraw(amounts[i]);
            payable(recipient).transfer(amounts[i]);
        } 
        emit Withdraw(swap, msg.sender, recipient, amount);  
    }

    /**
     * @dev Withdraws single token from the given pool. Emits a {Withdraw} event. Note: If there are any tokens left to be withdrawn after swaps they will be sent to the {{recipient}} in a respective token (not in {token}).
     * @param swap - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param token  - Address of a token to exit the pool with.
     * @param swapData - Parameters with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return amountToken - {token} amount sent to the {recipient}.
     * @return amounts - Dust amounts sent to the {recipient}.
     */
    function withdrawSingleAsset(address swap, uint256 amount, address token, bytes[] calldata swapData, address recipient) external returns(uint256 amountToken, uint256[] memory amounts){
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        address[] memory tokens = _convertToAddressArray(getTokens(swap));
        require (swapData.length == tokens.length, 'INPUT_PARAMS_LENGTHS_NOT_MATCH');

        amounts = new uint256[](tokens.length);
        farm.withdraw(amount, msg.sender, address(this));
        amounts = _removeLiquidity(swap, amount, tokens, amounts, address(this));

        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) {
                amountToken += amounts[i];
                amounts[i] = 0;
                continue;
            }
            IERC20(tokens[i]).approve(OneInchRouter, amounts[i]);
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[i], token);
            amountToken += returnAmount;
            // Dust
            amounts[i] -= spentAmount;
            IERC20Upgradeable(tokens[i]).safeTransfer(recipient, amounts[i]);
        }
        
        IERC20Upgradeable(token).safeTransfer(recipient, amountToken);

        emit Withdraw(swap, msg.sender, recipient, amount);
    }
     
    /**
     * @dev Withdraws single ETH from the given pool. Emits a {Withdraw} event. Note: If there are any tokens left to be withdrawn after swaps they will be sent to the {{recipient}} in a respective token (not in ETH).
     * @param swap - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param swapData - Parameters with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return amountETH - ETH amount sent to the {recipient}.
     * @return amounts - Dust amounts sent to the {recipient}.
     */
    function withdrawSingleETH(address swap, uint256 amount, bytes[] calldata swapData, address recipient) external returns(uint256 amountETH, uint256[] memory amounts){
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        address[] memory tokens = _convertToAddressArray(getTokens(swap));
        require (swapData.length == tokens.length, 'INPUT_PARAMS_LENGTHS_NOT_MATCH');

        amounts = new uint256[](tokens.length);
        farm.withdraw(amount, msg.sender, address(this));
        amounts = _removeLiquidity(swap, amount, tokens, amounts, address(this));

        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == WETH) {
                amountETH += amounts[i];
                amounts[i] = 0;
                continue;
            }
            IERC20(tokens[i]).approve(OneInchRouter, amounts[i]);
            (uint256 returnAmount, uint256 spentAmount) = _swap(swapData[i], WETH);
            amountETH += returnAmount;
            // Dust
            amounts[i] -= spentAmount;
            IERC20Upgradeable(tokens[i]).safeTransfer(recipient, amounts[i]);
        }

        IWETH(WETH).withdraw(amountETH);
        payable(recipient).transfer(amountETH);

        emit Withdraw(swap, msg.sender, recipient, amount);
    }

    /** 
     * @dev Withdraws LP tokens from the given pool. Emits a {Withdraw} event.
     * @param swap - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param recipient - The address which will receive tokens.
     */ 
    function withdrawLP(address swap, uint256 amount, address recipient) external {
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');
        
        farm.withdraw(amount, msg.sender, recipient);
        emit Withdraw(swap, msg.sender, recipient, amount);  
    }

    /**
     * @dev Distributes tokens between users.
     * @param swap - Address of the Swap contract.

     * @param rewardSwapInfos - Arrays of structs with token arrays describing swap routes from reward to tokens in {swap} and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param rewarderSwapInfos - Arrays of structs with token arrays describing swap routes from rewarder to tokens in {swap} and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeSwapInfos - Arrays of structs with token arrays describing swap routes (rewardTokenToFeeToken, rewarderTokenToFeeToken) and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address swap,
        Farm.SwapInfo[] calldata rewardSwapInfos,
        Farm.SwapInfo[] calldata rewarderSwapInfos,
        Farm.SwapInfo[2] calldata feeSwapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) {
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        uint256 reward = farm.distribute(
            rewardSwapInfos,
            rewarderSwapInfos,
            feeSwapInfos,
            IUnoFarm.FeeInfo(feeTo, fee)
        );
        emit Distribute(swap, reward);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {swap}.
     * @param _address - The address to check stakes for.
     * @param swap - Address of the Swap contract.

     * @return stakeLP - Total user stake(in LP tokens).
     */
    function userStake(address _address, address swap) external view returns (uint256 stakeLP) {
        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm != Farm(address(0))) {
            stakeLP = farm.userBalance(_address);
        }
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param swap - Address of the Swap contract.

     * @return totalDepositsLP - Total deposits (in LP tokens).
     */
    function totalDeposits(address swap) external view returns (uint256 totalDepositsLP) {
        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm != Farm(address(0))) {
            totalDepositsLP = farm.getTotalDeposits();
        }
    }

    /**
     * @dev Deposits assets to router
     */ 
    function _addLiquidity(
        address swap,
        uint256[] memory amounts, 
        IERC20[] memory tokens,
        uint256 minAmountLP,
        Farm farm
    ) internal returns(uint256 liquidity){
        bool joinPool;
        for (uint256 i = 0; i < amounts.length; i++) {
            if(amounts[i] > 0){
                if(!joinPool){
                    joinPool = true;
                }
                tokens[i].approve(address(swap), amounts[i]);
            }
        }
        require (joinPool, 'NO_LIQUIDITY_PROVIDED');
        liquidity = ISwap(swap).addLiquidity(amounts, minAmountLP, block.timestamp);
        IERC20Upgradeable(farm.lpPool()).safeTransfer(address(farm), liquidity);
    }

    /**
     * @dev Withdraws assets from router.
     */ 
    function _removeLiquidity(
        address swap,
        uint256 amount, 
        address[] memory tokens,
        uint256[] memory minAmounts,
        address recipient
    ) internal returns(uint256[] memory amounts){
        require(minAmounts.length == tokens.length, "BAD_MIN_AMOUNTS_LENGTH");
        amounts = ISwap(swap).removeLiquidity(amount, minAmounts, block.timestamp);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20Upgradeable(tokens[i]).safeTransfer(recipient, amounts[i]);
        }
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

    function _convertToAddressArray(IERC20[] memory tokenArray) internal pure returns (address[] memory addresses) {
        addresses = new address[](tokenArray.length);
        for (uint256 i = 0; i < tokenArray.length; i++) {
            addresses[i] = address(tokenArray[i]);
        }
    }

    /**
     * @dev Returns addresses of tokens in {swap}.
     * @param swap - Swap to check tokens in.

     * @return tokens - Array of token addresses.
     */  
    function getTokens(address swap) public view returns(IERC20[] memory tokens){
        uint8 tokenCount;
        address[] memory _tokens = new address[](type(uint8).max);
        for (uint8 i = 0; i < type(uint8).max; i++) {
            try ISwap(swap).getToken(i) returns (address token) {
                _tokens[i] = token;
                tokenCount++;
            } catch (bytes memory /*lowLevelData*/) {
                break;
            }
        }
        require(tokenCount > 0, "NO_TOKENS_IN_SWAP");

        tokens = new IERC20[](tokenCount);
        for (uint8 i = 0; i < tokenCount; i++) {
            tokens[i] = IERC20(_tokens[i]);
        }
        return tokens;
    }

    /**
     * @dev Change fee amount.
     * @param _fee -New fee to collect from farms. [10^18 == 100%]
     *
     * Note: This function can only be called by ADMIN_ROLE.
     */ 
    function setFee(uint256 _fee) external onlyRole(ADMIN_ROLE){
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

    function _authorizeUpgrade(address) internal override onlyRole(ADMIN_ROLE) {}
}
