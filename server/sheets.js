const { google } = require('googleapis');
const { getAuthClient } = require('./auth');

const getSheetsClient = (authClient = null) => {
    const auth = authClient || getAuthClient();
    if (!auth) throw new Error('Not authenticated for Sheets');
    return google.sheets({ version: 'v4', auth });
};

const getSheetNameByGid = async (spreadsheetId, gid, authClient = null) => {
    const sheets = getSheetsClient(authClient);
    const res = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const sheet = res.data.sheets.find(s => s.properties.sheetId === Number(gid));
    return sheet ? sheet.properties.title : null;
};

const ensureHeader = async (spreadsheetId, sheetName, headers, authClient = null) => {
    const sheets = getSheetsClient(authClient);
    const range = `'${sheetName}'!A1:Z1`;

    // Check if first row exists
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range
    });

    if (!res.data.values || res.data.values.length === 0) {
        console.log(`Creating headers for ${sheetName}...`);
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${sheetName}'!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [headers] }
        });
    }
};

const appendRow = async (spreadsheetId, gid, rowData, options = {}) => {
    try {
        const authClient = options.authClient || null;
        const sheetName = await getSheetNameByGid(spreadsheetId, gid, authClient);
        if (!sheetName) throw new Error(`Sheet with GID ${gid} not found`);

        const headers = Object.keys(rowData);
        const values = Object.values(rowData);

        // Ensure headers exist
        await ensureHeader(spreadsheetId, sheetName, headers, authClient);

        // Append Row
        const sheets = getSheetsClient(authClient);
        console.log(`Appending row to ${sheetName}...`);

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `'${sheetName}'`, // Append to end of sheet
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [values] }
        });

        return true;
    } catch (e) {
        console.error('Sheets Append Error:', e.message);
        return false;
    }
};

module.exports = { appendRow };
