/* eslint-disable no-undef */
import puppeteer  from "puppeteer";
import emailjs, {EmailJSResponseStatus}  from "@emailjs/nodejs";
import dotenv from "dotenv";

dotenv.config();
const THREE_MINUTES  = 3 * 60000;

const url = process.env.URL;
const serviceId = process.env.SERVICE_ID;
const publicKey = process.env.PUBLIC_KEY;
const privateKey = process.env.PRIVATE_KEY;

let attempts = 0;

async function webScrape () {
	attempts++;
	console.log("Web scrape running...", new Date());
	const browser = await puppeteer.launch({ headless: "new"});
	const page = await browser.newPage();
	await page.goto(url);
    
	const objects = await page.evaluate(() => {
		const columns = document.getElementsByClassName("col-sm-4 col-md-4 col-lg-4");
		return Array.from(columns).map((art) => {
			const moveInDate = art.querySelector(".move-in-date")?.innerHTML || "";
			const areaMessy = art.querySelector(".area_in_cm")?.innerHTML || "";
			const areaSplit = areaMessy.split("<span>")[0] + "m²";
			const [rooms, area] = areaSplit.split(",");
			const link = art.querySelector(".address_link")?.querySelector("a");
			const address = link?.innerHTML || "";
			const href = link?.getAttribute("href");
			const id = href?.match(/\/([^\\/]*)$/)[1] || "";
			return {
				moveInDate,
				area,
				address,
				href,
				id,
				rooms,
			};
		});
	});
	
	for (const i in objects) {
		const {href} = objects[i];
		await page.goto(href);
		try {
			// Not possible to use variables inside evaluate scope that is defined outside it........
			const data = await page.evaluate(() => {
				const newData = {};
				const applyType = document.querySelector(".AdShorthandDetails_homeq-shorthand-detail__R_giv")?.querySelector("p")?.innerHTML || "";
				newData.applyType = applyType.replace(/^Sortering:\s+/, "");
				const uploadString = document.querySelector(".AdTransparency_homeq-ad-transparency-container__4J_Ar")?.querySelector("p")?.innerHTML || "";
				const regex = /\btimmar\b/;
				newData.newUpload = regex.test(uploadString);

				const statsContainer = document.querySelector(".AdStats_homeq-ad-stats-list__gOlTo")?.querySelectorAll(".AdStats_homeq-ad-stat__6RvQx");

				newData.rent = statsContainer && statsContainer[0]?.querySelectorAll("p")[1]?.innerHTML || "";
			
				newData.floor = statsContainer && statsContainer[3]?.querySelectorAll("p")[1]?.innerHTML || "";

				const amenitySection = document.querySelector(".ObjectAd_homeq-ad-amenities-container__9auiL");
				const amenityContainer = amenitySection?.querySelectorAll(".Amenity_homeq-ad-amenity-container__pa_Z1"); 
				newData.elevator = amenityContainer && !!amenityContainer[0]?.querySelector(".Amenity_homeq-ad-amenity-exists__H_1Us");
				newData.patio = amenityContainer && !!amenityContainer[1]?.querySelector(".Amenity_homeq-ad-amenity-exists__H_1Us");
				newData.balcony = amenityContainer && !!amenityContainer[2]?.querySelector(".Amenity_homeq-ad-amenity-exists__H_1Us");


				return newData;
			});
			objects[i] = {
				...objects[i],
				...data,
			};

		} catch (error) {
			console.log("Failed to scrape websites", error);		
		}
	}
	await browser.close();
	console.log("Web scrape done.");

	const newObjects = objects.filter((obj) => obj.newUpload);
	return newObjects;
}

async function sendEmail(objs) {
	emailjs.init({publicKey, privateKey});
	let templateID = "";
	let emailValue = {};
	attempts = 0;
	if(objs.length) {
		// Send email with objects
		console.log("Email technically sent with new objects", );
		templateID = process.env.TEMPLATE_FOUND_ID;
		emailValue = getHtmlFormat(objs);
	} else {
		// Send empty template email
		console.log("No new objects found but email was sent either way", );
		templateID = process.env.TEMPLATE_NOTHING_ID;
		emailValue = { attempts };
	}

	try {
		await emailjs.send(serviceId, templateID, emailValue);
		console.log("Email sent");
	} catch (error) {
		if (error instanceof EmailJSResponseStatus) {
			console.log("EMAILJS FAILED...", error);
			return;
		}
		console.log("ERROR: FAILED TO SEND EMAIL", error);
	}
}

function runCodeAtSpecificTime(targetTime) {
	console.log("Setting new timeout for", targetTime);
	const timeDifference = targetTime - new Date();
	setTimeout(async () => {
		const objects = await webScrape();
		const stopRetrying = new Date() > new Date().setHours(15,25, 0,0);
		if(!objects.length && !stopRetrying) {
			console.log("No result.. Trying again in 3 minutes!");
			runCodeAtSpecificTime(getRetryTime());
		} else {
			console.log("We got some objects or we stopped retrying, sending email!");
			sendEmail(objects);
			runCodeAtSpecificTime(getTomorrowStartDate());
		}
	}, timeDifference);
}  

function getHtmlFormat(objects) {
	const values = {};
	objects.forEach((obj, i) => {
		values[`obj${i}`] = `<h3>${obj.address}</h3>
		<div><b>Ansökningstyp</b> ${obj.applyType} </div>
		<div><b>Hyra</b> ${obj.rent} </div>
		<div><b>Rum</b> ${obj.rooms}  </div>
		<div><b>Area</b> ${obj.area} </div>
		<div><b>Balkong</b> ${obj.balcony ? "Ja" : "Nej"} </div>
		<div><b>Uteplats</b> ${obj.patio ? "Ja" : "Nej"} </div>
		<div><b>Våning</b> ${obj.floor} </div>
		<div><b>Hiss</b> ${obj.elevator ? "Ja" : "Nej"} </div>
		<div><a href=${obj.href} target="_blank">Länk</a></div>
		<div>_____________________________</div>`;
	});
	const numOfApartments = objects.length;
	const apartment = numOfApartments === 1 ? "ny lägenhet" : "nya lägenheter";
	values.title = `${numOfApartments} ${apartment} hos Contentus!`;
	return values;
}

function getTomorrowStartDate() {
	const startDate = new Date();
	startDate.setDate(startDate.getDate() + 1); // Set to the following day
	startDate.setHours(0, 3, 0, 0); // Set to 00:03
	return startDate;
}


function getRetryTime() {
	const now = new Date();
	return new Date(now.getTime() + THREE_MINUTES); 
}

function init() {
	console.log("Web scraper has been initialized.");
	const now = new Date();
	const targetTime = new Date(
		now.getTime() + 10 * 1000,
	);
	// const startDate = getTomorrowStartDate();

	runCodeAtSpecificTime(targetTime);
}
init();