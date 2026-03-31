//to monitor from serial, open cmd.exe  type    particle serial monitor
/*
*                                     +-----+
*                          +----------| USB |----------+
*                          |          +-----+       *  |
*                     5    | [*] VIN           3V3 [ ] |
*                          | [ ] GND           RST [ ] |
*                          | [ ] TX           VBAT [ ] |
*                          | [ ] RX  [S]   [R] GND [*] |---------5
*                          | [ ] WKP            D7 [o] |  OLED RST
*                          | [ ] DAC +-------+  D6 [o] |  OLED D/C
*       OLED D1/MOSI       | [o] A5  |   *   |  D5 [ ] |
*                          | [ ] A4  |Photon |  D4 [ ] |
*       OLED D0/SCK        | [o] A3  |       |  D3 [ ] |
*       OLED CS            | [o] A2  +-------+  D2 [*] |-------------Temp Sensor Data (Yellow Wire)and 1K Pullup
*                          | [ ] A1             D1 [*] |-------------Open for future use (and 1k pullup)----GND
*                          | [ ] A0             D0 [*] |-------------Open for future use (and 1k pullup)----GND
*                          |                           |
*                           \    []         [______]  /
*                            \_______________________/
*
*  
*
*    MicroOLED                Photon
*      GND ------------------- GND
*      VDD ------------------- 3.3V (VCC)
*      D1/MOSI --------------- A5 (don't change)
*      D0/SCK ---------------- A3 (don't change)
*      D2
*      D/C ------------------- D6 (can be any digital pin)
*      RST ------------------- D7 (can be any digital pin)
*      CS  ------------------- A2 (can be any digital pin)
*/


//  C:\Users\Eric\Google Drive\Projects\TP KASA control with Particle info.txt

// Control Kasa:  https://www.codeproject.com/Tips/5162567/Control-a-tp-link-Smart-Plug-from-Windows-Without

/****************************************
 * Include Libraries
 ****************************************/
#include "Ubidots.h"
#include "Particle.h"
#include <SparkFunMicroOLED.h>
#undef swap  // Undefine the conflicting macro from SparkFunMicroOLED
#include <DS18B20.h>
#include <HC_SR04.h>
#include "ArduinoJson.h"
#include <string>
#include <algorithm>
#include <cctype>
 
SYSTEM_THREAD(ENABLED);
 
/* Function prototypes -------------------------------------------------------*/
int tinkerDigitalRead(String pin);
int tinkerDigitalWrite(String command);
int tinkerAnalogRead(String pin);
int tinkerAnalogWrite(String command);

int SpeedyRunTimer = 0;
int QuickRunTimer = 0;
int LogRunTimer = 0;
int LastDashDataRun = 0;
int SpeedyRunLength = 500;				//Update every 500 milliseconds when idle          .5 seconds
int QuickRunLength = 5000;				//Update every 5000 milliseconds when idle          5 seconds
int LogRunLength = 300000;				//Update every 300000 milliseconds when idle        5 minutes
int MaxRetryGetTemp = 3;
int ScreenSaver = 0;

bool isTextVisible = LOW;
bool FridgeHeaterOn = false;                 //High will make the assumption it is on
bool FridgeHeaterEnabled = HIGH;
bool FridgeTempWarningPublishOnce = LOW;
bool FreezerTempWarningPublishOnce = LOW;
bool PowerFailPublishOnce = LOW;
bool HasDisplayInstalled = HIGH;            //What this does is not update the display if it doesn't have one.  It slows it down looking for it.
                                            //low = not sump pump, has display   high = is sump pump, no display
double temp0F;
double GarageTemp;
double FreezerTemp;
double FridgeTemp;
double HeaterRunTime;
double HeaterLastRunTime;
double FridgeMinTempAlert = 32;
double FridgeMaxTempAlert = 45;
double FridgeStartHeatingTemp = 33;
double FridgeStopHeatingTemp =  36;
double FreezerMinTempAlert = -20;
double FreezerMaxTempAlert = 10;
double Deadband = 3;

uint32_t msSampleTime = 2500;
uint32_t msPublishTime = 30000;

retained String TP_LINK_TOKEN = "d43e62a6-ATEggZOLXGPbKKU7ZLG3BP0";

int pinOneWire = D2;
int pinLED = D7;

// --- Time-based filtering variables ---
unsigned long tempOutOfRangeSince = 0;
bool alertSent = false;
const int ALERT_DELAY_MS = 30 * 60 * 1000; // 30 minutes

//  variables for alert/alarm cooldowns
unsigned long lastHeaterAttemptOn = 0;
unsigned long lastHeaterAttemptOff = 0;
const unsigned long heaterCooldown = 10 * 60 * 1000; // 10 minutes
unsigned long lastNotificationTime = 0;
const unsigned long notificationInterval = 60 * 60 * 1000; // 1 hour

// ========== FREEZER SENSOR WATCHDOG & RECONNECTION (Options 1 & 3) ==========
// Variables to track freezer temperature timeout and recovery attempts
unsigned long lastValidFreezerRead = 0;
const unsigned long FREEZER_RECONNECT_TIMEOUT = 5 * 60 * 1000;  // 5 minutes - try reconnect
const unsigned long FREEZER_FULL_RESET_TIMEOUT = 15 * 60 * 1000; // 15 minutes - full device reset
bool freezerReconnectAttempted = false;

char *WEBHOOK_NAME = "UbiHook";

Ubidots ubidots("webhook", UBI_PARTICLE);

DS18B20 ds18b20(pinOneWire);

const int NumberTempSensors = 3;

retained uint8_t sensorAddresses[NumberTempSensors][8];

void handleLoginResponse(const char *event, const char *data);

double temp_f[NumberTempSensors] = {NAN, NAN};

MicroOLED oled;

// Function to reconnect temperature sensors (Option 3)
void ReconnectTempSensor() {
    Serial.println("Attempting to reconnect temperature sensors...");
    Particle.publish("pushbullet", "Freezer sensor stuck - Attempting reconnection...", PRIVATE);
    
    ds18b20.resetsearch();
    delay(100);
    for (int i = 0; i < NumberTempSensors; i++) {
        ds18b20.search(sensorAddresses[i]);
    }
    
    freezerReconnectAttempted = true;
    Serial.println("Temperature sensors reconnection attempted");
}

// Having declared these variables, let's move on to the setup function.
// The setup function is a standard part of any microcontroller program.
// It runs only once when the device boots up or is reset.

void heaterResponseHandler(const char *event, const char *data);

void setup()
{
    lastHeaterAttemptOn  = millis() - heaterCooldown;
    lastHeaterAttemptOff = millis() - heaterCooldown;
    lastValidFreezerRead = millis(); // Initialize watchdog timer
    
    //Setup the Tinker application here
    //Register all the Tinker functions
    //Particle.function allows code on the device to be run when requested from the cloud API.
    Particle.function("digitalread", tinkerDigitalRead);
    Particle.function("digitalwrite", tinkerDigitalWrite);
    Particle.function("analogread", tinkerAnalogRead);
    Particle.function("analogwrite", tinkerAnalogWrite);
    Particle.function("setFridgeHeater", setFridgeHeaterHandler);
    
    //Particle.variable registers a variable, so its value can be retrieved from the cloud in the future.
    Particle.variable("GarageTemp", GarageTemp);
	Particle.variable("FreezerTemp", FreezerTemp);
	Particle.variable("FridgeTemp", FridgeTemp);
	Particle.variable("FridgeHeaterOn", FridgeHeaterOn);
	Particle.variable("HeaterRunTime", HeaterRunTime);
	Particle.variable("FridgeHeaterEnabled", FridgeHeaterEnabled);
	
    pinMode(pinLED, OUTPUT);
    pinMode(pinOneWire, INPUT_PULLUP);
    ds18b20.resetsearch();                 // initialize for temperature sensor search
    for (int i = 0; i < NumberTempSensors; i++) 
    {   // try to read the temp sensor addresses (can use multiple)
       ds18b20.search(sensorAddresses[i]); // and if available store them
    }
    
    oled.begin();            // Initialize the OLED
    oled.clear(ALL);         // Clear the display's internal memory
    oled.display();          // Display what's in the buffer (splashscreen)
    delay(1);              // Delay 500 ms if you want to see SparkFun logo, else, lets just get going and skip it.
    oled.clear(PAGE);        // Clear the buffer.
    Serial.begin(9600);
    
    delay(10000);              // Delay  
    FridgeHeaterOn = LOW;   //consider the heater off
    delay(10);              // Delay
    String data = String::format("{\"TOKEN_VAL\":\"%s\"}", TP_LINK_TOKEN.c_str());
    Particle.publish("FridgeHeaterOff", data, PRIVATE);  //turn the heater off
    
    String myID = System.deviceID();
    if(myID == "1f0020001347353136383631") {HasDisplayInstalled = LOW;}  //This is the ID for the Snazzy photon, this is the only one with the display currently, so the only one we need to update the display on.  HIGH is sump pump, no updates, LOW has display
    if(myID == "240039000e47353136383631") {HasDisplayInstalled = LOW;}  //This is the ID for the JeepGarage photon, this is the other only one with the display currently, so the other only one we need to update the display on.  HIGH is sump pump, no updates, LOW has display
    if(HasDisplayInstalled == LOW)      //If no display then skip this section to minimize delays.
    {
       printTitle("E.T.", 1);
    }
    
    // Subscribe to webhook response events for error checking
    Particle.subscribe("hook-response/FridgeHeaterOn", heaterResponseHandler, MY_DEVICES);
    Particle.subscribe("hook-response/FridgeHeaterOff", heaterResponseHandler, MY_DEVICES);
    Particle.subscribe("hook-response/KasaLogin", handleLoginResponse, MY_DEVICES);

}

    // Next we have the loop function, the other essential part of a microcontroller program.
    // This routine gets repeated over and over, as quickly as possible and as many times as possible, after the setup function is called.
    // Note: Code that blocks for too long (like more than 5 seconds), can make weird things happen (like dropping the network connection).  
    // The built-in delay function shown below safely interleaves required background activity, so arbitrarily long delays can safely be done if you need them.

void loop()
{
    unsigned long currentMillis = millis();
    if (SpeedyRunTimer <= currentMillis)                                   //Run every x seconds when idle
    {
        SpeedyRunTimer = (currentMillis + SpeedyRunLength);
        // Toggle the flag in your main loop (outside UpdateDisplay)
        isTextVisible = !isTextVisible;
    }
    
    if (QuickRunTimer <= currentMillis)                                   //Run every x seconds when idle
    {
        QuickRunTimer = (currentMillis + QuickRunLength);
        temp0F = GetTemp();                                    //Gets temp from Sensor 0
        GarageTemp = temp_f[0];
        FreezerTemp = temp_f[1];
        FridgeTemp = temp_f[2];
        
        // ===== FREEZER SENSOR WATCHDOG LOGIC (Options 1 & 3) =====
        if (!isnan(FreezerTemp)) {
            // Valid reading received - reset the watchdog
            lastValidFreezerRead = currentMillis;
            freezerReconnectAttempted = false; // Reset reconnection flag for next timeout
        } else {
            // Freezer reading is invalid (NaN)
            unsigned long timeSinceLastValid = currentMillis - lastValidFreezerRead;
            
            // Option 3: Try sensor reconnection after 5 minutes of no valid reading
            if (timeSinceLastValid > FREEZER_RECONNECT_TIMEOUT && !freezerReconnectAttempted) {
                ReconnectTempSensor();
            }
            
            // Option 1: If still stuck after 15 minutes, perform full device reset
            if (timeSinceLastValid > FREEZER_FULL_RESET_TIMEOUT) {
                Serial.println("CRITICAL: Freezer sensor timeout! Performing full device reset...");
                Particle.publish("pushbullet", "CRITICAL: Freezer sensor timeout after reconnect attempt. Resetting device...", PRIVATE);
                delay(2000); // Give cloud time to publish
                System.reset(); // Full device reset
            }
        }
        // ===== END FREEZER SENSOR WATCHDOG LOGIC =====
        
        //Serial.println(String(FridgeTemp) + ", " + String(FreezerTemp));  // print 2 temperatures to serial port
        //Serial.println(ExtPowerLevel);
    

		if (FridgeTemp < FridgeMinTempAlert || FridgeTemp > FridgeMaxTempAlert)
		{
			if (tempOutOfRangeSince == 0) {
				tempOutOfRangeSince = millis(); // start timer
			} else if (!alertSent && millis() - tempOutOfRangeSince >= ALERT_DELAY_MS) {
				Particle.publish("pushbullet", "Fridge Temperature Check! " + String(FridgeTemp) + " Degrees F.", PRIVATE);
				alertSent = true;
			}
		}
		else
		{
			// Temperature is back in range — reset everything
			tempOutOfRangeSince = 0;
			alertSent = false;
		}

        if(FreezerTemp < FreezerMinTempAlert or FreezerTemp > FreezerMaxTempAlert)
        {
           if (FreezerTempWarningPublishOnce == LOW)
            {
                Particle.publish("pushbullet", "Freezer Temperature Check! " + String(FreezerTemp) + " Degrees F.", PRIVATE);     // push the notification to phone via pushbullet via webhook
                FreezerTempWarningPublishOnce = HIGH;
            }
        }
        
        if(FreezerTemp > (FreezerMinTempAlert + Deadband) and FreezerTemp < (FreezerMaxTempAlert - Deadband) )       //this creates a deadband, it would send rapid messages when it got to setpoint, flickering above and below setpoint.
        {
            FreezerTempWarningPublishOnce = LOW;
        }
        
        // Fridge heater controller

        if (FridgeHeaterOn != HIGH)              //If fridge gets too cold, then turn on KASA plug  HeaterOn check is to prevent sending on command every loop
        {
            HeaterRunTime = 0;                  //clears the run time of the heater
            HeaterLastRunTime = currentMillis / 60000;   //records the start time of when the heater turned on.
            
            if ((FridgeTemp < FridgeStartHeatingTemp) && FridgeHeaterEnabled != LOW && (currentMillis - lastHeaterAttemptOn > heaterCooldown))
            {
                lastHeaterAttemptOn = currentMillis;
                FridgeHeaterOn = HIGH;
                String data = String::format("{\"TOKEN_VAL\":\"%s\"}", TP_LINK_TOKEN.c_str());
                Particle.publish("FridgeHeaterOn", data, PRIVATE);
            }
        }

        if((FridgeTemp > FridgeStopHeatingTemp) && FridgeHeaterOn != LOW && (currentMillis - lastHeaterAttemptOff > heaterCooldown))
        {
            lastHeaterAttemptOff = currentMillis;
            FridgeHeaterOn = LOW;
            String data = String::format("{\"TOKEN_VAL\":\"%s\"}", TP_LINK_TOKEN.c_str());
            Particle.publish("FridgeHeaterOff", data, PRIVATE);
        }

       // Serial.println(String(FridgeTemp) + ", " + String(FridgeHeaterOn));  // print 2 temperatures to serial port
    }
        if (currentMillis - LastDashDataRun >= 120000)        	//Update every 120 seconds to publish to when idle
        {        
			LastDashDataRun = currentMillis;
           // Create a JSON payload with all current temperatures
            char tempPayload[150]; // Adjust size if needed
                     
            snprintf(tempPayload, sizeof(tempPayload),
                     "{\"garage\":%.2f, \"freezer\":%.2f, \"fridge\":%.2f, \"heater\":%.2f, \"heateron\":%d}",
                     GarageTemp, FreezerTemp, FridgeTemp, HeaterRunTime,
                     FridgeHeaterOn ? 1 : 0);
            // Publish the combined temperature data
              Particle.publish("GarageWebHook", tempPayload, PRIVATE);
              
        }
    
    if (LogRunTimer <= currentMillis)                                   //Run every x milliseconds when idle
    {
        LogRunTimer = (currentMillis + LogRunLength);
        temp0F = GetTemp();                                    //Gets temp from Sensor 0
        HeaterRunTime = currentMillis / 60000 - HeaterLastRunTime;
    
        if (!isnan(FridgeTemp)) ubidots.add("FridgeTemp", FridgeTemp); // Change for your variable name
        if (!isnan(FreezerTemp)) ubidots.add("FreezerTemp", FreezerTemp); // Change for your variable name
        if (!isnan(GarageTemp)) ubidots.add("GarageTemp", GarageTemp); // Change for your variable name
        if (!isnan(HeaterRunTime)) ubidots.add("HeaterRunTime", HeaterRunTime);

        Particle.publish("healthcheck-ping", "80ff094a-8941-48f5-b648-d7c3cb8342be", PRIVATE);

//        bool bufferSent = ubidots.send(WEBHOOK_NAME, PUBLIC); // Will use particle webhooks to send data
        
        ScreenSaver = random(5);
        
    }

    if(HasDisplayInstalled == LOW)          //If no display then skip this section to minimize delays.
    {
        UpdateDisplay(String(FridgeTemp, 1), String(FreezerTemp, 1), String(GarageTemp, 1));
    }
    delay(100);
}
/*******************************************************************************
*                        end of main loop
*******************************************************************************/

/*******************************************************************************
* Function Name  : GetTemp
* Description    : Reads the temperature from sensor
* Input          : Definded at top
* Output         : None.
* Return         : Temperature as double in an array starting at 0 up to NumberTempSensors
*******************************************************************************/
int GetTemp()
{
    int addr;
	for (int i = 0; i < NumberTempSensors; i++)
	{
		double temp = ReadTempFromSensor(sensorAddresses[i]);
		if (!isnan(temp)) temp_f[i] = temp;
	}
	return 100;
}
    
double ReadTempFromSensor(uint8_t addr[8])                      //This is where actual read from sensor happens
{
	double _temp;
	int   i = 0;
	do
		{
			_temp = ds18b20.convertToFahrenheit(ds18b20.getTemperature(addr));  //retrieves temp and converts it to Farenheit
		}
	while (!ds18b20.crcCheck() && MaxRetryGetTemp > i++);                        //try until good reading, up to Max
	if (i >= MaxRetryGetTemp)                                                     //if it didn't hit max then print serial temp
		{
			_temp = NAN;                                                        //then set it to NAN (not a number)
		}
    return _temp; 
}                //exit ReadTempFromSensor and return temps

/*******************************************************************************
* Function Name  : UpdateDisplay
*******************************************************************************/

void UpdateDisplay(String DisplayTemp0, String DisplayTemp1, String DisplayTemp2)
{
    oled.clear(PAGE);                                   // Clear the display
    oled.setFontType(0);                                // 0 = Smallest font
    
    oled.setCursor(ScreenSaver, 5 + ScreenSaver);        // Set cursor to start position (left, top) in pixels
    oled.print("Fr: ");
    
    if (FridgeTempWarningPublishOnce and isTextVisible) { // Check if text should be visible
            oled.print("");}
        else{oled.print(DisplayTemp0);}

    oled.setCursor(ScreenSaver, 15 + ScreenSaver);       // Set cursor to start position (left, top) in pixels
    oled.print("Fz: ");
    
    if (FreezerTempWarningPublishOnce and isTextVisible) { // Check if text should be visible
        oled.print("");}
    else{oled.print(DisplayTemp1);}

    oled.setCursor(ScreenSaver, 25 + ScreenSaver);       // Set cursor to start position (left, top) in pixels
    oled.print("G:  ");
    oled.print(DisplayTemp2);
    
    oled.display();
}

    
void printTitle(String title, int font)
{
    int middleX = oled.getLCDWidth() / 2;
    int middleY = oled.getLCDHeight() / 2;
    
    oled.clear(PAGE);
    oled.setFontType(font);
    // Try to set the cursor in the middle of the screen
    oled.setCursor(middleX - (oled.getFontWidth() * (title.length()/2)), middleY - (oled.getFontWidth() / 2));
    // Print the title:
    oled.print(title);
    oled.display();
    delay(500);
    oled.clear(PAGE);
}

//TINKER stuff below is for tinker control with phone app.

/*******************************************************************************
* Function Name  : tinkerDigitalRead
* Description    : Reads the digital value of a given pin
* Input          : Pin
* Output         : None.
* Return         : Value of the pin (0 or 1) in INT type
Returns a negative number on failure
*******************************************************************************/
int tinkerDigitalRead(String pin)
{
    //convert ascii to integer
    int pinNumber = pin.charAt(1) - '0';
    //Sanity check to see if the pin numbers are within limits
    if (pinNumber< 0 || pinNumber >7) return -1;

    if(pin.startsWith("D"))
    {
        pinMode(pinNumber, INPUT_PULLDOWN);
        return digitalRead(pinNumber);
    }
    else if (pin.startsWith("A"))
    {
        pinMode(pinNumber+10, INPUT_PULLDOWN);
        return digitalRead(pinNumber+10);
    }
    return -2;
}

/*******************************************************************************
* Function Name  : tinkerDigitalWrite
* Description    : Sets the specified pin HIGH or LOW
* Input          : Pin and value
* Output         : None.
* Return         : 1 on success and a negative number on failure
*******************************************************************************/
int tinkerDigitalWrite(String command)
{
    bool value = 0;
    //convert ascii to integer
    int pinNumber = command.charAt(1) - '0';
    //Sanity check to see if the pin numbers are within limits
    if (pinNumber< 0 || pinNumber >7) return -1;

    if(command.substring(3,7) == "HIGH") value = 1;
    else if(command.substring(3,6) == "LOW") value = 0;
    else return -2;

    if(command.startsWith("D"))
    {
        pinMode(pinNumber, OUTPUT);
        digitalWrite(pinNumber, value);
        return 1;
    }
    else if(command.startsWith("A"))
    {
        pinMode(pinNumber+10, OUTPUT);
        digitalWrite(pinNumber+10, value);
        return 1;
    }
    else return -3;
}

/*******************************************************************************
* Function Name  : tinkerAnalogRead
* Description    : Reads the analog value of a pin
* Input          : Pin
* Output         : None.
* Return         : Returns the analog value in INT type (0 to 4095)
Returns a negative number on failure
*******************************************************************************/
int tinkerAnalogRead(String pin)
{
    //convert ascii to integer
    int pinNumber = pin.charAt(1) - '0';
    //Sanity check to see if the pin numbers are within limits
    if (pinNumber< 0 || pinNumber >7) return -1;
    
    if(pin.startsWith("D"))
    {
        return -3;
    }
    else if (pin.startsWith("A"))
    {
        return analogRead(pinNumber+10);
    }
    return -2;
}

/*******************************************************************************
* Function Name  : tinkerAnalogWrite
* Description    : Writes an analog value (PWM) to the specified pin
* Input          : Pin and Value (0 to 255)
* Output         : None.
* Return         : 1 on success and a negative number on failure
*******************************************************************************/
int tinkerAnalogWrite(String command)
{
    //convert ascii to integer
    int pinNumber = command.charAt(1) - '0';
    
    //Sanity check to see if the pin numbers are within limits
    if (pinNumber< 0 || pinNumber >7) return -1;
    
    String value = command.substring(3);
    
    if(command.startsWith("D"))
    {
        pinMode(pinNumber, OUTPUT);
        analogWrite(pinNumber, value.toInt());
        return 1;
    }
    else if(command.startsWith("A"))
    {
        pinMode(pinNumber+10, OUTPUT);
        analogWrite(pinNumber+10, value.toInt());
        return 1;
    }
    else return -2;
}

/*******************************************************************************
* Function Name  : setFridgeHeaterHandler
* Description    : Enables or disables the Fridge Heater via the Particle Cloud
* Input          : String: 'on' or 'off'
* Output         : None.
* Return         : 1 on, 0 off, and a negative number on failure
*******************************************************************************/

int setFridgeHeaterHandler(String command) {
    command.toLowerCase();
    if (command == "on") {
        FridgeHeaterEnabled = HIGH;
        Serial.println("Fridge heater enabled via cloud.");
        return 1;
    } else if (command == "off") {
        FridgeHeaterEnabled = LOW;
        Serial.println("Fridge heater disabled via cloud.");
        return 0;
    } else {
        Serial.println("Invalid command for Fridge heater. Use 'on' or 'off'.");
        return -1;
    }
}

/*******************************************************************************
* Function Name  : heaterResponseHandler
* Description    : Handles responses from the webhook for FridgeHeaterOn/Off
* Input          : Event name and data
* Output         : None.
* Return         : None
*******************************************************************************/
void heaterResponseHandler(const char *event, const char *data) {
    Serial.println("Response: " + String(data));

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, data);

    if (error) {
        Serial.println("JSON parse failed: " + String(error.c_str()));
        if (millis() - lastNotificationTime > notificationInterval) {
            lastNotificationTime = millis();
            Particle.publish("pushbullet", "Fridge Heater JSON parse failed!", PRIVATE);
        }
        // Revert state
        bool isOnCommand = (strstr(event, "On") != NULL);
        FridgeHeaterOn = !isOnCommand;
        return;
    }

    int error_code = doc["error_code"].as<int>();

    if (error_code != 0) {
        std::string notification;
        if (error_code == -20651 || error_code == -20002) {
            notification = "TP-Link token expired. Auto-renewing...";
            Particle.publish("KasaLogin", "", PRIVATE);
        }
        else {
            std::string errMsg = doc["msg"].as<std::string>();
            if (errMsg.empty()) {
                errMsg = doc["error_description"].as<std::string>();
            }
            if (errMsg.empty()) {
                errMsg = "Unknown error";
            }
            notification = "Fridge Heater command failed: " + errMsg;
        }
        if (millis() - lastNotificationTime > notificationInterval) {
            lastNotificationTime = millis();
            Particle.publish("pushbullet", notification.c_str(), PRIVATE);
        }
        // Revert state
        bool isOnCommand = (strstr(event, "On") != NULL);
        FridgeHeaterOn = !isOnCommand;
        return;
    }

    JsonObject result = doc["result"];
    std::string responseData = result["responseData"].as<std::string>();

    JsonDocument innerDoc;
    error = deserializeJson(innerDoc, responseData.c_str());

    if (error) {
        Serial.println("Inner JSON parse failed: " + String(error.c_str()));
        if (millis() - lastNotificationTime > notificationInterval) {
            lastNotificationTime = millis();
            Particle.publish("pushbullet", "Fridge Heater inner JSON parse failed!", PRIVATE);
        }
        // Revert state
        bool isOnCommand = (strstr(event, "On") != NULL);
        FridgeHeaterOn = !isOnCommand;
        return;
    }

    int err_code = innerDoc["system"]["set_relay_state"]["err_code"].as<int>();

    if (err_code != 0) {
        std::string notification = "Fridge Heater command failed with err_code: " + std::to_string(err_code);
        if (millis() - lastNotificationTime > notificationInterval) {
            lastNotificationTime = millis();
            Particle.publish("pushbullet", notification.c_str(), PRIVATE);
        }
        // Revert state
        bool isOnCommand = (strstr(event, "On") != NULL);
        FridgeHeaterOn = !isOnCommand;
        return;
    }
    // Success - state is already set, no action needed
    Serial.println("Heater command successful.");
    
}
void handleLoginResponse(const char *event, const char *data)
    {
        Serial.println("Login response:");
        Serial.println(data);
    
        JsonDocument doc;
        if (deserializeJson(doc, data)) {
            Serial.println("Login JSON parse failed");
            return;
        }
    
        const char* token = doc["result"]["token"];
    
        if (token && strlen(token) > 10) {
            TP_LINK_TOKEN = String(token);
            Serial.println("✅ New TP-Link token stored:");
            Serial.println(TP_LINK_TOKEN);
            Particle.publish("pushbullet", "Fridge monitor renewed TP-Link token.", PRIVATE);
        } else {
            Serial.println("❌ Login succeeded but no token found.");
        }
    }
