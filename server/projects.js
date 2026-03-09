const projects = [
    {
        id: 'laserlift',
        name: 'Laserlift Solutions',
        domain: 'laserliftsolutions.com',
        url: 'https://laserliftsolutions.com/',
        ga4PropertyId: '503587971',
        spreadsheetId: '1VpSfz6pVmGbgltxcs4UNmDEhHfo0Vh4kMDwtFUaOaWM',
        sheetGid: 0
    },
    {
        id: 'fleetflow',
        name: 'FleetFlow',
        domain: 'fleetflow.hyvikk.com',
        url: 'https://fleetflow.hyvikk.com/',
        ga4PropertyId: '518947686',
        spreadsheetId: '1VpSfz6pVmGbgltxcs4UNmDEhHfo0Vh4kMDwtFUaOaWM',
        sheetGid: 1772579534
    }
];

const getProject = (id) => {
    return projects.find(p => p.id === id) || projects[0];
};

module.exports = { projects, getProject };
