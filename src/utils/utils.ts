export function renderDate(date: Date) {
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const month = MONTHS[date.getMonth()];

  return `${month} ${date.getUTCDate()} ${date.getFullYear()}`;
}
