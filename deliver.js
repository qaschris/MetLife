const cp = require('child_process');
// This script requires the 'request' node.js module.
// This section grabs required node modules not packaged with
// the Automation Host service prior to executing the script.
const req = async module => {
    try {
        require.resolve(module);
    } catch (e) {
        console.log(`=== could not resolve "${module}" ===\n=== installing... ===`);
        cp.execSync(`npm install ${module}`);
        await setImmediate(() => {});
        console.log(`=== "${module}" has been installed ===`);
    }
    console.log(`=== requiring "${module}" ===`);
    try {
        return require(module);
    } catch (e) {
        console.log(`=== could not include "${module}" ===`);
        console.log(e);
        process.exit(1);
    }
}

const main = async () => {

    const {
        execSync
    } = await req("child_process");
    const fs = await req('fs');
    const path = await req('path');
    const request = await req('request');
    const xml2js = await req('xml2js');

    const pulseUri = 'https://pulse-us-east-1.qtestnet.com/webhook/49776246-db5a-4c5c-b857-426f9aecc1a6'; // Pulse parser webhook endpoint
    const projectId = '74528'; // target qTest Project ID
    const cycleId = '5634942'; // target qTest Test Cycle ID

    var result = '';

    /*
    // Build command line for test execution.  Place any scripts surrounding build/test procedures here.
    // Comment out this section if build/test execution takes place elsewhere.
    let command = '';
    
    console.log(`=== executing command ===`);
    console.log(command);
    execSync(command, {stdio: "inherit"});
    console.log(`=== command completed ===`);
    // Build section end.
    */

    // edit these to reflect your results file and Extent HTML attachment path, escape the slashes as seen below
    let resultsPath = 'C:\\repo\\- Customer Specific -\\Metlife\\target\\surefire-reports\\testng-results.xml';
    let attachmentsPath = 'C:\\repo\\- Customer Specific -\\Metlife\\reports';

    let attachmentsArray = [];
    let attachments = [];

    // check if the results file exists and read it
    try {
        result = fs.readFileSync(resultsPath, 'ascii');
        console.log('=== read results file successfully ===');
        // iterate through the results file to get classnames for HTML report attachments
        xml2js.parseString(result, {
            preserveChildrenOrder: true,
            explicitArray: false,
            explicitChildren: false
        }, function(err, xmlcontents) {
            if (err) {
                console.log('=== error: ' + err + ' ===');
            } else {
                var suites = Array.isArray(xmlcontents['testng-results'].suite) ? xmlcontents['testng-results'].suite : [xmlcontents['testng-results'].suite];
                suites.forEach(function(suite) {
                    var tests = Array.isArray(suite.test) ? suite.test : [suite.test];
                    tests.forEach(function(test) {                        
                        attachmentsArray.push(test.$.name);
                    });
                });
            }
        });
    } catch (e) {
        console.log('=== error: ', e.stack, ' ===');
    }

    // check if the attachments path exists, loop through files, and read them in
    try {
        if (fs.existsSync(attachmentsPath)) {
            console.log('=== read attachments path successfully ===');
            var files = fs.readdirSync(attachmentsPath);
            console.log('=== ' + files.length + ' attachment files counted ===')
            for (f = 0; f < files.length; f++) {
                try {
                    var filename = files[f];
                    console.log('=== checking for test matching file: ' + filename.split('.').slice(0, -1).join('.') + ' ===');
                    if ((filename.indexOf('.html') >= 0) && (attachmentsArray.includes(filename.split('.').slice(0, -1).join('.')))) {
                        attachment = fs.readFileSync(attachmentsPath + '\\' + files[f], 'ascii');
                        attachmentName = files[f];
                        console.log('=== read attachment file ' + attachmentName + ' successfully ===');
                        // base64 encode the contents of the results file
                        let buff = new Buffer(attachment);
                        let base64data = buff.toString('base64');
                        var encodedAttachment = {
                            'name': attachmentName,
                            'data': base64data
                        }
                        attachments.push(encodedAttachment);
                    }
                } catch (e) {
                    console.log('=== error: ', e.stack, ' ===');
                }
            }
        }

    } catch (e) {
        console.log('=== error: ', e.stack, ' ===');
    }

    // base64 encode the results file
    let buff = new Buffer.from(result);
    let base64data = buff.toString('base64');

    // establish the options for the webhook post to Pulse parser
    var opts = {
        url: pulseUri,
        json: true,
        body: {
            'projectId': projectId,
            'testcycle': cycleId,
            'result': base64data,
            'attachments': attachments
        }
    };

    // perform the post
    console.log(`=== uploading results... ===`)
    return request.post(opts, function(err, response, resbody) {
        if (err) {
            Promise.reject(err);
        } else {
            //console.log(response);
            //console.log(resbody);
            Promise.resolve("Uploaded results successfully.");
        }
    });
};

main();