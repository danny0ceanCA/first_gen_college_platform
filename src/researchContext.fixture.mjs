// Reconstruct test evidence without making assumptions about packet boundaries.
export function decodedResearchContext(packets) {
  if (!packets[0]?.unit) return JSON.parse(packets.map(packet => packet.text).join(''));
  const units = [], groups = new Map();
  for (const packet of packets) {
    if (!packet.group) units.push(packet);
    else {
      const key = `${packet.resultId}:${packet.group}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(packet);
    }
  }
  for (const parts of groups.values()) {
    parts.sort((a, b) => a.part - b.part);
    if (parts.length !== parts[0].total) throw Error('incomplete test evidence');
    units.push({unit: parts[0].unit, ...JSON.parse(parts.map(part => part.text).join(''))});
  }
  return {
    ...units.find(unit => unit.unit === 'state'),
    findings: units.filter(unit => unit.unit === 'finding'),
    sources: units.filter(unit => unit.unit === 'source'),
  };
}
