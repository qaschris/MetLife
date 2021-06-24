/**
 * call source: delivery script from CI Tool (Jenkins, Bamboo, TeamCity, CircleCI, etc), Launch, locally executed
 *              see 'delivery' subdirectory in this repository
 * payload example:
 * {
 *   properties: 'example value'
 *   arrayOfItems: [ { <properties and example values> } ]
 * }
 * constants:
 * - SCENARIO_PROJECT_ID: 84d46c6a-d39d-11e9-bb65-2a2ae2dbcce4
 * - QTEST_TOKEN: 84d46c6a-d39d-11e9-bb65-2a2ae2dbcce4
 * outputs:
 * - The unformatted items in the payload will be formatted into qTest test case
 * - The test cases then will be added to qTest project
 * - The unformatted result will be sent to the trigger "TriggerName"
 * - The ChatOps channel (if there is any) will notificate the result or error
 */

const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    // Payload to be passed in: json style cucumber for java test results

    /////// Pulse version
    var payload = body;
    var projectId = payload.projectId;
    var cycleId = payload.testcycle;

    let testResults = Buffer.from(payload.result, 'base64').toString('utf-8');
    if (testResults.match(/[^\x00-\x7F]/g)) {
        console.log('[INFO]: Found invalid non-ascii characters, removing them.')
        testResults = testResults.replace(/[^\x00-\x7F]/g, "");
    }

    //console.log(testResults);
    testResults = JSON.parse(testResults);

    var testLogs = [];
    //console.log("TEST RESULTS: " + testResults);

    //emitEvent('ChatOpsEvent', { TESTRESULTS: testResults });

    testResults.forEach(function (feature) {
        var featureName = feature.name;
        feature.elements.forEach(function (testCase) {

            if (!testCase.name)
                testCase.name = "Unnamed";

            TCStatus = "passed";

            var reportingLog = {
                exe_start_date: new Date(), // TODO These could be passed in
                exe_end_date: new Date(),
                module_names: [
                    featureName
                ],
                name: testCase.name,
                automation_content: feature.uri + "#" + testCase.name
            };

            var testStepLogs = [];
            order = 0;
            stepNames = [];
            attachments = [];

            testCase.steps.forEach(function (step) {
                stepNames.push(step.name);

                var status = step.result.status;
                var actual = step.name;

                if (TCStatus == "passed" && status == "skipped") {
                    TCStatus = "skipped";
                }
                if (status == "failed") {
                    TCStatus = "failed";
                    actual = step.result.error_message;
                }
                if (status == "undefined") {
                    TCStatus = "incomplete";
                    status = "incomplete";                    
                    emitEvent('ChatOpsEvent', { message: "Step result not found: " + step.name + "; marking as incomplete." });
                }

                // Are there an attachment for this step?
                if ("embeddings" in step) {
                    console.log('[INFO]: Has attachment in step.');

                    attCount = 0;
                    step.embeddings.forEach(function (att) {
                        attCount++;
                        var attachment = {
                            name: step.name + " Attachment " + attCount,
                            "content_type": att.mime_type,
                            data: att.data
                        };
                        console.log('[INFO]: Attachment: ' + attachment.name)

                        attachments.push(attachment);
                    });
                }

                var expected = step.keyword + " " + step.name;

                if ("location" in step.match) {
                    expected = step.match.location;
                }

                var stepLog = {
                    order: order,
                    description: step.keyword + ' ' + step.name,
                    expected_result: step.name,
                    actual_result: actual,
                    status: status
                };

                testStepLogs.push(stepLog);
                order++;
            });

            testCase.after.forEach(function (after) {
                // Are there an attachment for this after?
                if ("embeddings" in after) {
                    console.log('[INFO]: Has attachment in after.');
                    console.log('[DEBUG]: ' + after.match.location);
                    console.log('[DEBUG]: ' + after.embeddings[0].mime_type);

                    var attachment = {
                        name: after.match.location + '.' + after.embeddings[0].mime_type.split('/')[1],
                        "content_type": after.embeddings[0].mime_type,
                        data: after.embeddings[0].data
                    };
                    console.log("[INFO]: Attachment: " + attachment.name)

                    attachments.push(attachment);
                }
            });

            reportingLog.attachments = attachments;
            reportingLog.description = stepNames.join("<br/>");
            reportingLog.status = TCStatus;
            reportingLog.test_step_logs = testStepLogs;
            reportingLog.featureName = featureName;
            testLogs.push(reportingLog);
        });
    });

    var formattedResults = {
        "projectId": projectId,
        "testcycle": cycleId,
        "logs": testLogs
    };

    emitEvent('UpdateQTestWithFormattedResults', formattedResults);

}
