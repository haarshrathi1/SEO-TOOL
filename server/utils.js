function getWeeklyDateRange() {
    const now = new Date();
    // Step 1: Find the most recent Sunday that has passed
    const currentDay = now.getDay(); // 0 = Sun, 1 = Mon...
    const daysSinceLastSunday = currentDay + 7;

    const sunday = new Date(now);
    sunday.setDate(now.getDate() - daysSinceLastSunday);

    // Step 2: Set Saturday as 6 days after that Sunday
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);

    const ymd = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    return {
        startDate: ymd(sunday),
        endDate: ymd(saturday),
        weekLabel: `Week ${ymd(sunday)} -> ${ymd(saturday)}`
    };
}

module.exports = { getWeeklyDateRange };
