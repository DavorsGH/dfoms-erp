const USAGE = `
Hikvision ISAPI HTTP Listening simulator

PowerShell examples:

  # Fingerprint success (multipart, default)
  node scripts/simulate-hikvision-device.mjs --token YOUR_TOKEN --pin 20

  # Face success as JSON
  node scripts/simulate-hikvision-device.mjs --token YOUR_TOKEN --pin 20 --sub 75 --format json

  # XML body (older firmware)
  node scripts/simulate-hikvision-device.mjs --token YOUR_TOKEN --pin 20 --format xml

  # Heartbeat
  node scripts/simulate-hikvision-device.mjs --token YOUR_TOKEN --heartbeat

  # Multipart with a tiny fake JPEG part (should be ignored)
  node scripts/simulate-hikvision-device.mjs --token YOUR_TOKEN --pin 20 --with-picture

  # Bad token (expect 401)
  node scripts/simulate-hikvision-device.mjs --bad-token --pin 20

  # Custom time / serial
  node scripts/simulate-hikvision-device.mjs --token YOUR_TOKEN --pin 0020 --time 2026-10-24T08:05:00+00:00 --serial 42
`.trim();

function parseArgs(argv) {
  const options = {
    baseUrl: "http://localhost:3000",
    token: "",
    pin: "20",
    time: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    sub: 38,
    serial: String(Math.floor(Date.now() / 1000) % 100000),
    format: "multipart",
    withPicture: false,
    heartbeat: false,
    badToken: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (flag === "--base-url") {
      options.baseUrl = argv[++index] ?? options.baseUrl;
      continue;
    }
    if (flag === "--token") {
      options.token = argv[++index] ?? "";
      continue;
    }
    if (flag === "--pin") {
      options.pin = argv[++index] ?? options.pin;
      continue;
    }
    if (flag === "--time") {
      options.time = argv[++index] ?? options.time;
      continue;
    }
    if (flag === "--sub") {
      options.sub = Number.parseInt(argv[++index] ?? "38", 10) || 38;
      continue;
    }
    if (flag === "--serial") {
      options.serial = argv[++index] ?? options.serial;
      continue;
    }
    if (flag === "--format") {
      options.format = (argv[++index] ?? "multipart").toLowerCase();
      continue;
    }
    if (flag === "--with-picture") {
      options.withPicture = true;
      continue;
    }
    if (flag === "--heartbeat") {
      options.heartbeat = true;
      continue;
    }
    if (flag === "--bad-token") {
      options.badToken = true;
      continue;
    }
  }

  if (options.badToken) {
    options.token = `bad-${Math.random().toString(36).slice(2, 12)}`;
  }

  return options;
}

function buildEventJson(options) {
  if (options.heartbeat) {
    return {
      macAddress: "aa:bb:cc:dd:ee:ff",
      dateTime: options.time,
      eventType: "heartBeat",
      eventState: "active",
    };
  }

  return {
    ipAddress: "192.168.1.50",
    macAddress: "aa:bb:cc:dd:ee:ff",
    dateTime: options.time,
    eventType: "AccessControllerEvent",
    eventState: "active",
    eventDescription: "Access Controller Event",
    AccessControllerEvent: {
      deviceName: "Simulator",
      majorEventType: 5,
      subEventType: options.sub,
      employeeNoString: options.pin,
      serialNo: Number.parseInt(options.serial, 10) || options.serial,
      currentVerifyMode: "faceOrFpOrCardOrPw",
      attendanceStatus: "checkIn",
      name: "Sim User",
    },
  };
}

function buildEventXml(options) {
  if (options.heartbeat) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <macAddress>aa:bb:cc:dd:ee:ff</macAddress>
  <dateTime>${options.time}</dateTime>
  <eventType>heartBeat</eventType>
</EventNotificationAlert>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <macAddress>aa:bb:cc:dd:ee:ff</macAddress>
  <dateTime>${options.time}</dateTime>
  <eventType>AccessControllerEvent</eventType>
  <majorEventType>5</majorEventType>
  <subEventType>${options.sub}</subEventType>
  <employeeNoString>${options.pin}</employeeNoString>
  <serialNo>${options.serial}</serialNo>
  <currentVerifyMode>faceOrFpOrCardOrPw</currentVerifyMode>
  <attendanceStatus>checkIn</attendanceStatus>
  <name>Sim User</name>
</EventNotificationAlert>`;
}

function tinyJpegBytes() {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
    0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

async function postBody(options, url) {
  const event = buildEventJson(options);

  if (options.format === "json") {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    return response;
  }

  if (options.format === "xml") {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: buildEventXml(options),
    });
    return response;
  }

  const form = new FormData();
  form.append(
    "event_log",
    new Blob([JSON.stringify(event)], { type: "application/json" }),
    "event_log.json",
  );
  if (options.withPicture) {
    form.append(
      "Picture",
      new Blob([tinyJpegBytes()], { type: "image/jpeg" }),
      "Picture.jpg",
    );
  }
  return fetch(url, { method: "POST", body: form });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!options.token) {
    console.error("Provide --token or --bad-token (see --help)");
    process.exit(1);
  }

  const base = options.baseUrl.replace(/\/$/, "");
  const url = `${base}/api/attendance/hikvision/${encodeURIComponent(options.token)}`;
  console.log(`POST ${url}`);
  console.log(
    `format=${options.format} pin=${options.pin} sub=${options.sub} heartbeat=${options.heartbeat}`,
  );

  const response = await postBody(options, url);
  const text = await response.text();
  console.log(`HTTP ${response.status}`);
  if (text) {
    console.log(text);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
