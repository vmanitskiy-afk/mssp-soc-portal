export const INCIDENT_TYPES = [
  { value: 'malware', label: 'Malware', desc: 'Вредоносное ПО' },
  { value: 'phishing', label: 'Phishing', desc: 'Фишинговые атаки' },
  { value: 'network_attack', label: 'Network Attack', desc: 'Сетевые атаки' },
  { value: 'unauthorized_access', label: 'Unauthorized Access', desc: 'Несанкционированный доступ' },
  { value: 'account_compromise', label: 'Account Compromise', desc: 'Компрометация учетных записей' },
  { value: 'privilege_escalation', label: 'Privilege Escalation', desc: 'Повышение привилегий' },
  { value: 'lateral_movement', label: 'Lateral Movement', desc: 'Горизонтальное перемещение по сети' },
  { value: 'command_and_control', label: 'Command and Control', desc: 'Связь с инфраструктурой злоумышленника' },
  { value: 'reconnaissance', label: 'Reconnaissance', desc: 'Разведывательная активность' },
  { value: 'vulnerability_exploitation', label: 'Vulnerability Exploitation', desc: 'Эксплуатация уязвимостей' },
  { value: 'security_misconfiguration', label: 'Security Misconfiguration', desc: 'Небезопасные настройки' },
  { value: 'data_exfiltration', label: 'Data Exfiltration', desc: 'Попытка или процесс вывода данных' },
  { value: 'data_breach', label: 'Data Breach', desc: 'Подтвержденная утечка данных' },
  { value: 'denial_of_service', label: 'Denial of Service', desc: 'Отказ в обслуживании' },
  { value: 'policy_violation', label: 'Policy Violation', desc: 'Нарушение политик безопасности' },
  { value: 'insider_threat', label: 'Insider Threat', desc: 'Внутренние угрозы' },
  { value: 'cloud_security_incident', label: 'Cloud Security Incident', desc: 'Инциденты в облачных средах' },
  { value: 'supply_chain_compromise', label: 'Supply Chain Compromise', desc: 'Компрометация через поставщиков' },
  { value: 'other', label: 'Other', desc: 'Прочее' },
] as const;

export const INCIDENT_TYPE_GROUPS = [
  { label: 'Базовые категории', types: ['malware', 'phishing', 'network_attack', 'unauthorized_access', 'account_compromise', 'privilege_escalation', 'lateral_movement', 'command_and_control', 'reconnaissance', 'vulnerability_exploitation', 'security_misconfiguration'] },
  { label: 'Инциденты, связанные с данными', types: ['data_exfiltration', 'data_breach'] },
  { label: 'Доступность и устойчивость', types: ['denial_of_service'] },
  { label: 'Организационные и внутренние угрозы', types: ['policy_violation', 'insider_threat'] },
  { label: 'Облачные и цепочки поставок', types: ['cloud_security_incident', 'supply_chain_compromise'] },
  { label: 'Прочее', types: ['other'] },
];

export function getIncidentTypeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const found = INCIDENT_TYPES.find(t => t.value === value);
  return found ? `${found.label} — ${found.desc}` : value;
}

export function getIncidentTypeShort(value: string | null | undefined): string {
  if (!value) return '—';
  const found = INCIDENT_TYPES.find(t => t.value === value);
  return found ? found.label : value;
}
