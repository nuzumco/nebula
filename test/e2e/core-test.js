const { describe, it } = require('mocha');
const { expect } = require('chai');
const rp = require('request-promise');
const { trim } = require('lodash');
const { exec: _exec } = require('child-process-promise');
const path = require('path');
const fs = require('fs');
const util = require('util');
const writeFile = util.promisify(fs.writeFile);

const types = require('./../../constants/types');
const { CoreService } = require('./../../lib/services/core/core');
const { TerraformService } = require('./../../lib/services/terraform/terraform');

const c = new CoreService({});
const tf = new TerraformService({});

async function exec(cmd, opts) {
    console.log('[exec-call] $ ', cmd, opts);
    const result = await _exec(cmd, opts);

    console.log('exit code: ', result.childProcess.exitCode);
    console.log('stdout: ', result.stdout);
    console.log('stderr: ', result.stderr);
    return result;
}

async function eventuallyReady(ip) {
    let pollCount = 0;
    let poll = true;

    do {
        console.log(`polling the cluster deployed service... [${pollCount}]`);
        console.log('IP: ', ip);

        const pollResultAsText = await rp(`http://${ip}:8080`)
            .catch((err) => ''); // We silent the error since we don't care
        // This is polling - remember!

        const strippedText = trim(pollResultAsText);
        console.log('polling result: ', pollResultAsText);
        if (strippedText === 'Hello, Cruel World!') {
            return true;
        } else {
            pollCount++;
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    } while (poll && pollCount < 60);

    return false;
}

describe('Nebula core', () => {
    it('should provision a new constellation and destroy it', async () => {
        const cloud = {
            type: types.clouds.aws,
            region: 'us-east-1',
            instanceType: 't2.micro',
        };

        const keys = {
            aws: {
                accessKey,
                secretKey,
            },
            ssh: {
                path: '~/.ssh/id_rsa.pub',
            },
            orbs: {
                publicKey: 'dfc06c5be24a67adee80b35ab4f147bb1a35c55ff85eda69f40ef827bddec173',
                privateKey: '93e919986a22477fda016789cca30cb841a135650938714f85f0000a65076bd4dfc06c5be24a67adee80b35ab4f147bb1a35c55ff85eda69f40ef827bddec173',
            }
        };

        const result = await c.createConstellation({ cloud, keys });
        expect(result.ok).to.equal(true);

        const pollingResult = await eventuallyReady(preExistingElasticIp);
        expect(pollingResult).to.equal(true);

        const destroyResult = await c.destroyConstellation({ spinContext: result.spinContext });
        expect(destroyResult.ok).to.equal(true);
    });

    it.only('should provision a new constellation with a pre-existing Elastic IP and destroy it', async () => {
        // First we will create an Elastic IP outside the scope of createConstellation()

        const awsRegion = 'us-east-1';
        const accessKey = process.env.AWS_ACCESS_KEY;
        const secretKey = process.env.AWS_SECRET_KEY;
        const targetDir = path.join(__dirname, 'eip_tf_state');

        // Write the variables file into place
        const variableData = `
        access_key = "${accessKey}"
        secret_key = "${secretKey}"
        region     = "${awsRegion}"
        `;

        await writeFile(path.join(targetDir, 'terraform.tfvars'), variableData);

        await exec(`terraform init`, { cwd: targetDir });

        const eipResult = await exec(`terraform apply -var-file=terraform.tfvars -auto-approve`, {
            cwd: targetDir,
        });

        const outputsCharPosition = eipResult.stdout.indexOf('Outputs:');
        const outputs = tf.parseOutputs(eipResult.stdout.substr(outputsCharPosition));

        const foobarIp = outputs.find(o => o.key === 'foobar.ip');
        const preExistingElasticIp = foobarIp.value;

        const cloud = {
            type: types.clouds.aws,
            region: 'us-east-1',
            instanceType: 't2.medium',
            ip: preExistingElasticIp,
        };

        const keys = {
            aws: {
                accessKey,
                secretKey,
            },
            ssh: {
                path: '~/.ssh/id_rsa.pub',
            },
            orbs: {
                publicKey: 'dfc06c5be24a67adee80b35ab4f147bb1a35c55ff85eda69f40ef827bddec173',
                privateKey: '93e919986a22477fda016789cca30cb841a135650938714f85f0000a65076bd4dfc06c5be24a67adee80b35ab4f147bb1a35c55ff85eda69f40ef827bddec173',
            }
        };

        const result = await c.createConstellation({ cloud, keys });
        expect(result.ok).to.equal(true);

        const pollingResult = await eventuallyReady(preExistingElasticIp);
        expect(pollingResult).to.equal(true);

        const destroyResult = await c.destroyConstellation({ spinContext: result.spinContext });
        expect(destroyResult.ok).to.equal(true);

        const eipPlanResult = await exec(`terraform plan -var-file=terraform.tfvars`, {
            cwd: targetDir,
        });

        const desiredMessageIndex = eipPlanResult.stdout.indexOf('No changes. Infrastructure is up-to-date');
        expect(desiredMessageIndex, 'Expecting to see the IP is still alive after destroying infra').to.not.equal(-1);

        // Clean up the IP as well
        console.log('cleaning up the pre-existing IP...');
        await exec(`terraform destroy -var-file=terraform.tfvars -auto-approve`, {
            cwd: targetDir,
        });
    });
});
