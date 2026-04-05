const READ_RECEIPT_BLOCK_FLAG = '__AURORA_BLOCK_READ_RECEIPTS__';
const readReceiptBlockTarget = globalThis;
export const getAuroraBlockReadReceipts = () => readReceiptBlockTarget[READ_RECEIPT_BLOCK_FLAG] === true;
export const setAuroraBlockReadReceipts = (enabled) => {
    readReceiptBlockTarget[READ_RECEIPT_BLOCK_FLAG] = enabled === true;
    return readReceiptBlockTarget[READ_RECEIPT_BLOCK_FLAG] === true;
};
export const clearAuroraBlockReadReceipts = () => {
    delete readReceiptBlockTarget[READ_RECEIPT_BLOCK_FLAG];
};
//# sourceMappingURL=read-receipt-guard.js.map