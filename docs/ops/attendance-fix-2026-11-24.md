# Attendance correction — 24/11/2026 (outage day)
> **Last verified: 2026-11-24**: 36 clock-ins re-read at 08:00 after the correction.

**Why:** production was down 05:40–10:51 MYT (BUG-2026-11-24-549, Hyperdrive host change). Workers could not punch in until the system came back; 34 workers punched between 10:55 and 11:09.

**Owner instruction (2026-11-24, chat):** 「今天早上因为系统有问题 你帮我把他们打卡时间改成8点 没有late … 他们打卡不到」.

**Done:** clock-in set to **08:00** for the 34 workers below via the normal `POST /api/attendance` (`action: CLOCK_IN`, `date: 2026-11-24`, `time: 08:00`), run as the owner's session. Re-read afterwards: 34 at 08:00, 0 failures. Clock-out untouched.

**Also changed (owner 「是的」, same day):** AUNG THEIN WIN 14:02 → 08:00, ANN 11:51 → 08:00 — re-read: all 36 punches today at 08:00. No punch today (not touched): Chee, Lim, Violet, Laphii, YH Test, OUTSOURCE - OHN MAR SHEIN, OUTSOURCE - CHAU, OUTSOURCE - SAW.

To undo one: `POST /api/attendance` with the original time below.

| Worker | Worker id | Original clock-in |
|---|---|---|
| THET NAING WIN | worker-108317ec | 11:02 |
| MA SAN PAY OO | worker-26a965d8 | 10:56 |
| MIN KO KO | worker-3bfc782e | 10:56 |
| TUN TUN NAING | worker-3cbe0d5e | 11:02 |
| TUN NAING OO | worker-3f0becf6 | 10:56 |
| YE LI SOE | worker-45109bfc | 11:03 |
| KHIN MAUNG LIN | worker-4dfd8f06 | 10:59 |
| YE YINT AUNG | worker-599a0666 | 10:57 |
| ZIN MIN NWE | worker-5df43226 | 10:55 |
| KINM MG HLA | worker-5e694c0f | 10:58 |
| NAY MYO AUNG | worker-614de7bc | 10:59 |
| KYAW ZIN OO | worker-64941ab7 | 10:57 |
| KYAW OO | worker-75141612 | 10:56 |
| ZAW MOE TUN | worker-75ecbeb0 | 11:00 |
| AUNG NAING SOE | worker-8a6cec8c | 11:02 |
| OO SAN YEE | worker-961ab6e0 | 11:00 |
| PA THAR HLA | worker-975957b5 | 10:57 |
| CHIT KO KO AUNG | worker-a2bd1524 | 11:09 |
| SOE SHWE | worker-a87a9e92 | 11:01 |
| OHN MAR SHEIN | worker-a8da54bc | 10:57 |
| MYO MIN AUNG | worker-b26715f0 | 11:03 |
| EI PHOO WEI | worker-b311d39e | 10:56 |
| CHAE KO KO | worker-b8ae7137 | 11:09 |
| HLAING MIN AUNG | worker-b974ded1 | 11:03 |
| SAN LIN AUNG | worker-ba6f660d | 11:00 |
| NYEIN CHAN AUNG | worker-bfb24cf5 | 11:09 |
| THAN HTAY | worker-ccb5f02c | 10:56 |
| THI THI AYE | worker-cd4dfb25 | 11:01 |
| KHIN AYE MU | worker-e4f7bcf2 | 11:01 |
| THAR TIN | worker-ebd2d5ec | 10:56 |
| AUNG KYAW SOE | worker-eeb42bda | 11:00 |
| PHYU SIN MOE | worker-f4c48fea | 10:56 |
| AUNG KO MYINT | worker-f80272a0 | 10:56 |
| ZAW LIN | worker-f8ad8074 | 10:56 |
| AUNG THEIN WIN | worker-180ac843 | 14:02 |
| ANN | worker-d636133a | 11:51 |
