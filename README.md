# LG ThinQ Induction → Kitchen Hood Automation

Serverless automation service built on Netlify Functions that automatically controls a kitchen hood (connected via a Smart Life / Tuya Smart Plug) based on the operating state of an LG ThinQ Induction Cooktop (BEF3AMB4E).

## 1. Project Goal & Flow

- **Cooktop active**: LG ThinQ Cooktop ON → Detect Operating State → Netlify Function → Tuya Cloud API → Smart Life Plug ON → Hood ON
- **Cooktop stopped**: LG ThinQ Cooktop OFF → Detect Stopped State → Wait 3 Minutes → Tuya Cloud API → Smart Life Plug OFF → Hood OFF

## 2. Devices

- **Cooktop**: LG ThinQ Induction (Model: `BEF3AMB4E`)
- **Hood**: Haatz Kitchen Hood (`HDB-MSHD63M`) connected to a Tuya / Smart Life smart plug
- **Smart Plug Control Datapoint**: `switch_1`
- **Smart Plug Monitoring Datapoint**: `cur_power`

## 3. Netlify Functions API Routes

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check endpoint |
| `/api/tuya-status` | GET | Check Tuya smart plug status (`switch_1`, `cur_power`, `fault`, etc.) |
| `/api/tuya-control` | POST | Turn plug ON/OFF (`{"on": true|false}`) with idempotency |
| `/api/lg-devices` | GET | List registered LG ThinQ devices |
| `/api/lg-status` | GET | Get current LG cooktop state & burner power levels |
| `/api/hood-automation` | GET | Evaluate induction state and trigger hood automation |

### Example LG ThinQ API Responses

#### `GET /api/lg-devices`
```json
{
  "ok": true,
  "data": [
    {
      "deviceId": "cooktop_device_id_123",
      "alias": "Kitchen Induction Cooktop",
      "deviceType": "COOKTOP",
      "modelName": "BEF3AMB4E",
      "online": true
    }
  ]
}
```

#### `GET /api/lg-status`
```json
{
  "ok": true,
  "data": {
    "deviceId": "a66e011fbd7c7777e315dd17bd13d65d89484cf41530ab023fc50f5761e2373e",
    "deviceName": "전기레인지",
    "modelName": "WBEF3ANHL",
    "online": true,
    "isOperating": true,
    "powerState": "ON",
    "burners": [
      {
        "burnerId": "burner1Power",
        "isOperating": true,
        "powerLevel": 7
      }
    ]
  }
}
```

#### `GET /api/hood-automation`
```json
{
  "ok": true,
  "data": {
    "action": "TURN_ON",
    "inductionState": "ON",
    "hoodState": "ON",
    "changed": true,
    "remainingDelaySeconds": 0,
    "message": "Induction cooktop active. Turned kitchen hood plug ON.",
    "evaluatedAt": "2026-08-30T22:19:02.000Z"
  }
}
```

## 4. Local Setup & Development

```bash
# Install dependencies
npm install

# Build TypeScript code
npm run build

# Run unit tests
npm run test

# Run Netlify local development server
npm run dev
```

## 5. Environment Variables Configuration

Copy `.env.example` to `.env` and fill in your credential values:

```env
LG_THINQ_PAT=
LG_CLIENT_ID=
LG_DEVICE_ID=
LG_API_ENDPOINT=https://api-korea.thinq.com

TUYA_ACCESS_ID=
TUYA_ACCESS_SECRET=
TUYA_DEVICE_ID=
TUYA_API_ENDPOINT=https://openapi.tuyacn.com
```

> **Security Note**: `.env` is strictly ignored by git. Never commit API keys or credentials.
