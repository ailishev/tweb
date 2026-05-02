export default function compareVersion(v1: string, v2: string): number {
  v1 = (v1 || '0').split(' ', 1)[0];
  v2 = (v2 || '0').split(' ', 1)[0];
  const s1 = v1.split('.');
  const s2 = v2.split('.');

  const maxLength = Math.max(s1.length, s2.length);
  for(let i = 0; i < maxLength; ++i) {
    const v1 = +s1[i];
    const v2 = +s2[i];
    const n1 = Number.isFinite(v1) ? v1 : 0;
    const n2 = Number.isFinite(v2) ? v2 : 0;
    if(n1 > n2) return 1;
    else if(n1 < n2) return -1;
  }

  return 0;
}
