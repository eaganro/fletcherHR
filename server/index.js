const express = require('express');
const parser = require('body-parser');
const mysql = require('mysql');
const axios = require('axios');
const request = require('request');
const cheerio = require('cheerio');
const dbhelper = require('../database/dbhelpers.js');
const app = express();

app.use(parser.json());
app.use(express.static(__dirname + '/../client/dist'));

// app.set('port', 8080);


app.post('/checkfavs', (req, res) => {
  const listings = req.body.data;
  const { username } = req.body;
  dbhelper.checkFavs(username, (faves) => {
    for (let i = 0; i < listings.length; i += 1) {
      for (let j = 0; j < faves.length; j += 1) {
        if (listings[i].addresses === faves[j].address) {
          listings[i].favorite = true;
        }
      }
    }
    res.status(200).send(listings);
  });
});

// This gets all of the data from API calls and web scraping
app.post('/zillow', (req, res) => {
  const inputZip = req.body.zip;
  const workAddress = req.body.userAddress.split(' ').join('+');
  const url1 = `https://www.zipcodeapi.com/rest/${INSERT API KEY HERE}/radius.json/${inputZip}/1/km`;
  // Request to the zipcode api to get all zipcodes within a certain radius
  // Need to update the key in url1 every day
  // Or get your own key but it will only give 50 searches a day
  request(url1, (error, response, dataa) => {
    const data = JSON.parse(dataa);
    const zipCodes = data.zip_codes.map(x => x.zip_code);
    // create all of the zillow urls for webscraping
    const urls = zipCodes.map(zip => `https://www.zillow.com/homes/${zip}_rb/`);
    let prices = [];
    let addresses = [];
    let images = [];
    const walking = [];
    const driving = [];
    const transit = [];
    let jLatLong;
    const hLatLong = [];
    // function for each zillow.com request
    const searchUrl = (i) => {
      request(urls[i], (err, resp, html) => {
        // cheerio is used to webscrape
        // selects elements from the downloaded html similarly to jquery
        const $ = cheerio.load(html);
        const imgs = $("div[class='zsg-photo-card-img'] img");
        const price = $("div[class='zsg-photo-card-caption']");
        const address = $("div[class='zsg-photo-card-caption']");

        address.each((x, add) => {
          addresses.push($(add).children().last().children().first().text());
        });

        price.each((x, p) => {
          prices.push($(p).children().eq(1).children().first().children().first().text() || $(p).children().eq(1).children().first().text());
        });

        imgs.each((x, img) => {
          images.push($(img).attr('src'));
        });

        // perform next zillow search or move on if last one
        if (i < urls.length - 1) {
          searchUrl(i + 1);
        } else {
          // data refactoring
          prices = prices.map(p => String(p));
          prices = prices.map((p) => {
            let start = false;
            let end = true;
            return p.split('').filter((c) => {
              if (c === '$') {
                start = true;
                return false;
              }
              if (start === true) {
                if (c === ',') {
                  return false;
                }
                if (isNaN(parseInt(c, 10))) {
                  end = false;
                }
              }
              return start === true && end === true;
            }).join('');
          });
          prices = prices.map(p => Number(p));

          addresses = addresses.map((a) => {
            return a.split(' ').map((x) => {
              let q = x.split('');
              if (q.indexOf('-') !== -1) {
                q = q.slice(0, q.indexOf('-'));
              }
              return q.join('');
            }).join(' ');
          });

          // data filtering to only get good results
          const addr = addresses.slice();
          addresses = addresses.filter((x, z) => addr.indexOf(addr[z]) === z && prices[z] !== 0 && prices[z] <= 20000 && addresses[z] !== '');
          images = images.filter((x, z) => addr.indexOf(addr[z]) === z && prices[z] !== 0 && prices[z] <= 20000 && addresses[z] !== '');
          prices = prices.filter((x, z) => addr.indexOf(addr[z]) === z && x !== 0 && x <= 20000 && addresses[z] !== '');
          // slicing data to only get the first 10 results, reduce to 5 for faster testing
          addresses = addresses.slice(0, 10);
          images = images.slice(0, 10);
          prices = prices.slice(0, 10);

          // function for googlemaps api calls
          const searchMaps = (homeAdd, x) => {
            const homeAddress = String(homeAdd).split(' ').join('+');
            let mapsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${workAddress}&destination=${homeAddress}&key=${INSERT API KEY HERE}&mode=driving`
            // first request for driving time
            request(mapsUrl, (mapErr, mapResp, mapHtmlW) => {
              if (JSON.parse(mapHtmlW).routes[0] !== undefined) {
                driving.push(JSON.parse(mapHtmlW).routes[0].legs[0].duration.text);
                if (!jLatLong) {
                  jLatLong = JSON.parse(mapHtmlW).routes[0].legs[0].start_location;
                }
                hLatLong.push(JSON.parse(mapHtmlW).routes[0].legs[0].end_location);
              } else {
                driving.push('error');
                hLatLong.push('error');
              }
              mapsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${workAddress}&destination=${homeAddress}&key=${INSERT API KEY HERE}&mode=transit`
              // second request for transit time
              request(mapsUrl, (mapErr, mapResp, mapHtmlD) => {
                if (JSON.parse(mapHtmlD).routes[0] !== undefined) {
                  transit.push(JSON.parse(mapHtmlD).routes[0].legs[0].duration.text);
                } else {
                  transit.push('error');
                }
                // move on to next address if any left
                if (x < addresses.length - 1) {
                  searchMaps(addresses[x + 1], x + 1);
                } else {
                  // send all data back to client
                  const obj = {
                    prices,
                    addresses,
                    images,
                    driving,
                    transit,
                    jLatLong,
                    hLatLong,
                  };
                  res.status(200).send(obj);
                }
              });
            });
          };
          searchMaps(addresses[0], 0);
        }
      });
    };
    searchUrl(0);
  });
});

// send a post request to database for a new user sign up
app.post('/signUp', (req, res) => {
  // obj.allow controls if a new user can sign up or not, since username is set as unique in the database
  const obj = {
    userName: '  ',
    allow: 1,
  };
  dbhelper.addNewUserSignUp(req.body.userName, req.body.password, (result, allow) => {
    if (allow === 0) {
      obj.allow = 0;
      res.status(400).send(obj);
    } else {
      obj.userName = req.body.userName;
      res.status(200).send(obj);
    }
  });
});

// send a post request to database to check login password, if not a match, set obj.allow to 0
app.post('/login', (req, res) => {
  const obj = {
    userName: '  ',
    allow: 1,
  };
  dbhelper.verifyExistingUserLogin(req.body.userName, (result) => {
    if (result.length === 0) {
      res.status(401).send();
    } else if (req.body.password === result[0].password) {
      obj.userName = req.body.userName;
      res.status(200).send(obj);
    } else {
      obj.allow = 0;
      res.status(400).send(obj);
    }
  });
});


app.post('/getFavs', (req, res) => {
  dbhelper.getFavs(req.body.username, (results) => {
    res.send(results);
  });
});

app.post('/favs', (req, res) => {
  const {
    price, address, image, transit, driving, hLatLong, userName
  } = req.body;

  dbhelper.saveFavs(price, address, image, transit, driving, hLatLong, userName, (result) => {
    res.send(result);
  });
});

app.post('/dfavs', (req, res) => {
  dbhelper.deleteFavs(req.body.address, req.body.userName, (result) => {
    res.send(result);
  });
});

let port = process.env.PORT || 3306;

app.listen((process.env.PORT || 3306), () => {
  console.log(`listening on port ${port}`);
});





module.exports.app = app;
