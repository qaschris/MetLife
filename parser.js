const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');
const {Webhooks} = require('@qasymphony/pulse-sdk');

let testLogs = [];
let testRunSteps = [];
let testName;
let className;

exports.handler = async function({
    event: body,
    constants,
    triggers
}, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    function submitResultsToQTest(projectId, cycleId, testLogs) {
        const formattedResults = {
            "projectId": projectId,
            "testcycle": cycleId,
            "logs": testLogs
        };

        emitEvent('UpdateQTestWithFormattedResults', formattedResults);
    }

    const updateTestCase = async(testCaseId, updatedTestCase) => {
        await new Promise(async(resolve, reject) => {
            console.log('[DEBUG]: Updating Test Case Id: ' + testCaseId);
            console.log('[DEBUG]: Updating Test Case Body: ' + JSON.stringify(updatedTestCase));

            var standardHeaders = {
                'Content-Type': 'application/json',
                'Authorization': `bearer ${constants.QTEST_TOKEN}`
            }

            var opts = {
                url: 'https://' + constants.ManagerURL + '/api/v3/projects/' + projectId + '/test-cases/' + testCaseId,
                json: true,
                headers: standardHeaders,
                body: updatedTestCase
            };

            await request.put(opts, async function(err, response, resbody) {
                if (err) {
                    reject();
                    console.log('[ERROR]: ' + err);
                    process.exit(1);
                    return;
                } else {
                    resolve();
                    console.log('[INFO]: Test Case Updated: ' + JSON.stringify(resbody));
                    return;
                }
            })
        })
    }

    const iterateTestSuites = async(suites) => {
        await new Promise(async(resolve, reject) => {
            for (var s = 0; s < suites.length; s++) {
                console.log('[INFO]: Processing Suite: ' + s);
                var suite = suites[s];
                var suiteName = suite.$.name;
                var tests = Array.isArray(suite.test) ? suite.test : [suite.test];
                for (var t = 0; t < tests.length; t++) {
                    console.log('[INFO]: Processing Test: ' + t);
                    var test = tests[t];
                    // we are ignoring this level of the results and just iterating through the classes
                    // we are recording classes at the test case level
                    var classes = Array.isArray(test.class) ? test.class : [test.class];
                    for (var c = 0; c < classes.length; c++) {
                        console.log('[INFO]: Processing Class: ' + c);
                        var testcase = classes[c];
                        var methodName;
                        var testCaseId;
                        var note = '';
                        var stack = '';
                        var stepNumber = 0;
                        var startTime;
                        var endTime;
                        var classStatus = 'PASS';
                        var attachments = [];
                        className = test.$.name;

                        // we are recording methods at the step level
                        var methods = Array.isArray(testcase['test-method']) ? testcase['test-method'] : [testcase['test-method']];
                        for (var m = 0; m < methods.length; m++) {
                            console.log('[INFO]: Processing Method: ' + m);
                            var method = methods[m];
                            methodName = method.$.name;
                            var methodStatus = method.$.status;
                            // this section pulls time information from the methods for the overarching test case
                            if (stepNumber == 0) {
                                startTime = method.$['started-at'];
                                startTime.setHours(startTime.getHours() + offset);
                                //this section pulls the test case ID from the params
                                var params = Array.isArray(method.params.param) ? method.params.param : [method.params.param];
                                for (var p = 0; p < params.length; p++) {
                                    console.log('[INFO]: Processing Param: ' + p);
                                    var param = params[p];
                                    if (param.value.trim().startsWith('TCID')) {
                                            testCaseId = param.value.trim().split('-')[1];
                                            console.log('[INFO]: Test Case ID Found: ' + testCaseId);
                                        };
                                };
                            }
                            endTime = method.$['finished-at'];
                            endTime.setHours(endTime.getHours() + offset);
                            // this section pulls the stack trace for failures and attaches it to the overarching test case
                            if (methodStatus != 'PASS') {
                                if (methodStatus == 'FAIL') {
                                    note = method.exception.message;
                                    stack = method.exception['full-stacktrace'];
                                    classStatus = methodStatus;
                                }
                            }

                            stepNumber++;
                        };
                        // this section searches for the existing test case in qTest and pulls the test steps
                        await searchForTestCase(testCaseId, classStatus).then(() => {
                            //console.log('[DEBUG]: Test Steps (after function): ' + JSON.stringify(testRunSteps));

                            var testLog = {
                                status: classStatus,
                                name: testName,
                                attachments: [],
                                note: note,
                                exe_start_date: startTime,
                                exe_end_date: endTime,
                                automation_content: className,
                                module_names: [suiteName],
                                test_step_logs: testRunSteps
                            };
                            if (stack !== '') {
                                testLog.attachments.push({
                                    name: `${methodName}.txt`,
                                    data: Buffer.from(stack).toString("base64"),
                                    content_type: 'text/plain'
                                });
                            }

                            for (var a = 0; a < payload.attachments.length; a++) {
                                if (payload.attachments[a].name === className + '.html') {
                                    testLog.attachments.push({
                                        name: payload.attachments[a].name,
                                        data: payload.attachments[a].data,
                                        content_type: 'text/html'
                                    });

                                    break;
                                }
                            }
                            //console.log('[DEBUG]: Test Log: ' + JSON.stringify(testLog));
                            testLogs.push(testLog);
                        }).catch((err) => {
                            console.log('[ERROR]: ' + err);
                            reject();
                            process.exit(1);
                        });
                    };
                };
            };
            resolve();
        });
    }

    const searchForTestCase = async(id, status) => {
        await new Promise(async(resolve, reject) => {
            var standardHeaders = {
                'Content-Type': 'application/json',
                'Authorization': `bearer ${constants.QTEST_TOKEN}`
            }

            var opts = {
                url: 'https://' + constants.ManagerURL + '/api/v3/projects/' + projectId + '/test-cases/' + id,
                json: true,
                headers: standardHeaders
            };

            var testCase;
            var testStep;
            var updatedTestCase;
            var updatedTestCaseSteps = [];
            testName = '';
            testRunSteps = [];

            await request(opts, async function(err, response, resbody) {
                if (err) {
                    reject();
                    console.log('[ERROR]: ' + err);
                    process.exit(1);
                    return;
                } else if (response.statusCode !== 200) {
                    reject();
                    console.log('[ERROR]: Response: ' + JSON.stringify(response.body) + '; Test Case not found, check the Test Case IDs in the TestNG result file.');
                    process.exit(1);
                    return;
                } else {
                    testCase = resbody;
                    emitEvent('ChatOpsEvent', { message: '[INFO]: Test Cases checked for id: ' + id + ', found ' + testCase.test_steps.length + ' steps.' });
                    console.log('[INFO]: Test Cases checked for id: ' + id + ', found ' + testCase.test_steps.length + ' steps.');
                    //console.log('[DEBUG]: ' + JSON.stringify(testCase));

                    testName = testCase.name;

                    for (c = 0; c < testCase.test_steps.length; c++) {
                        testStep = {
                            order: testCase.test_steps[c].order,
                            description: testCase.test_steps[c].description,
                            expected_result: testCase.test_steps[c].expected,
                            actual_result: testCase.test_steps[c].expected,
                            status: status
                        };
                        testRunSteps.push(testStep);
                    }

                    //console.log('[DEBUG]: Test Steps (in function): ' + JSON.stringify(testRunSteps));

                    let tcAutomationStatus = testCase.properties.find(obj => obj.field_name == 'Automation');
                    console.log('[DEBUG]: Automated?: ' + tcAutomationStatus.field_value_name);
                    let tcAutomationContent = testCase.properties.find(obj => obj.field_name == 'Automation Content');
                    console.log('[DEBUG]: Automation Content: ' + tcAutomationContent.field_value);

                    if (tcAutomationStatus.field_value_name == 'Yes') {
                        if (tcAutomationContent.field_value !== className) {
                            console.log('[ERROR]: Existing Test Case Automation Content Field (' + tcAutomationContent.field_value + ') does not match value from results file (' + className + '), check Test Case ID in TestNG results file.');
                            process.exit(1);
                            return;
                        }
                    }

                    if (tcAutomationStatus.field_value_name == 'No') {
                        for (c = 0; c < testCase.test_steps.length; c++) {
                            testStep = {
                                order: testCase.test_steps[c].order,
                                description: testCase.test_steps[c].description,
                                expected: testCase.test_steps[c].expected
                            };
                            updatedTestCaseSteps.push(testStep);
                        }

                        updatedTestCase = {
                            name: testName,
                            properties: [
                                {
                                  field_id: tcAutomationStatus.field_id,
                                  field_value: 711,
                                },                                
                                {
                                  field_id: tcAutomationContent.field_id,
                                  field_value: className,
                                }
                            ],
                            test_steps: updatedTestCaseSteps
                        }

                        await updateTestCase(id, updatedTestCase);
                    }

                    Promise.resolve('Test case checked successfully.');

                    resolve();
                }
            });

        });

    };

    const xml2js = require("xml2js");

    var payload = body;
    var projectId = payload.projectId;
    var cycleId = payload.testcycle;
    var offset = payload.offset;


    let testResults = Buffer.from(payload.result, 'base64').toString('ascii');
    //console.log(testResults);

    var timestamp = new Date();

    xml2js.parseString(testResults, {
        preserveChildrenOrder: true,
        explicitArray: false,
        explicitChildren: false
    }, async function(err, result) {
        if (err) {
            emitEvent('ChatOpsEvent', { message: "[ERROR]: Unexpected Error Parsing XML Document: " + err });
            console.log('[ERROR]: ' + err);
            process.exit(1);
        } else {
            //console.log(result); // logging the converted JSON object for troubleshooting, comment this line to clean up console log
            var suites = Array.isArray(result['testng-results'].suite) ? result['testng-results'].suite : [result['testng-results'].suite];
            await iterateTestSuites(suites).then(async() => {
                console.log('[DEBUG]: Test Logs: ' + JSON.stringify(testLogs));
                submitResultsToQTest(projectId, cycleId, testLogs);
            }).catch((err) => {
                console.log('[ERROR]: ' + err);
                process.exit(1);
            });
        }
    });


}
