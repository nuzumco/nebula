const uuid = require('uuid/v1');
const path = require('path');
const { trim, isError, isBoolean, isEmpty, isInteger } = require('lodash');

const types = require('./../../../constants/types');
const ora = require('ora');

const resourcesBasePath = path.join(__dirname, '../../../resources');
const terraformResourcesBasePath = path.join(resourcesBasePath, '/terraform');
const defaultCachePath = path.join('~/.nebula');

function base64JSON(source) {
    return Buffer.from(JSON.stringify(source)).toString("base64");
}

function serializeKeys(keys) {
    return {
        ['node-address']: keys.address,
        ['node-private-key']: keys.privateKey,
    };
}

class TerraformService {
    constructor(adapter, cachePath = defaultCachePath) {
        this.adapter = adapter;
        this.cachePath = cachePath;
    }

    async createSpinContextDirectory(contextId) {
        const { exitCode } = await this.adapter.createSpinContextDirectory(contextId);

        if (exitCode !== 0) {
            throw new Error("Couldn't create execution context directory for Terraform!");
        }

        return true;
    }

    tmpBasePath() {
        if (this.cachePath) {
            if (this.cachePath.substr(0, 1) === '~') {
                return this.resolveHome(this.cachePath);
            }
            return this.cachePath;
        }
        return path.join(__dirname, '../../../_terraform');
    }

    contextDirPath(spinContext) {
        return path.join(this.tmpBasePath(), spinContext);
    }

    createTerraformVariablesFile({ spinContext, cloud, keys }) {
        let contentAsString = '';

        // SSH key specific variables
        contentAsString += `path_to_ssh_pubkey = "${keys.ssh.path}"\n`;

        // Orbs federation member keyPair
        contentAsString += `orbs_member_public_key = "${keys.orbs.publicKey}"\n`;
        contentAsString += `orbs_member_private_key = "${keys.orbs.privateKey}"\n`;

        // We will stick this piece of identifier into each resource name we create to avoid
        // clashing with other resources on the same cloud region.
        contentAsString += `run_identifier = "${spinContext}"\n`;

        if (cloud.type === types.clouds.aws) {
            // AWS Credentials
            contentAsString += `aws_profile = "${keys.aws.profile}"\n`;

            // AWS Others
            contentAsString += `region = "${cloud.region}"\n`;

            //contentAsString += `aws_ami_id = "${this.getAMIByRegion(cloud.region)}"\n`;
            contentAsString += `aws_orbs_manager_instance_type = "${cloud.instanceType}"\n`;
            contentAsString += `aws_orbs_worker_instance_type = "${cloud.instanceType}"\n`;
            contentAsString += `aws_orbs_worker_instance_count = "${isInteger(cloud.nodeCount) ? cloud.nodeCount : 2}"\n`;

            contentAsString += `aws_ether_instance_type = "${cloud.instanceType}"\n`;

            contentAsString += `context_id = "${uuid()}"\n`;
            contentAsString += `node_key_pair = "${base64JSON(serializeKeys(keys.orbs.nodeKeys))}"\n`;

            contentAsString += `boyar_config_source =<<EOF\n${JSON.stringify(keys.orbs.boyarConfig)}\nEOF\n`;

            const boyarKey = "boyar/config.json"

            const boyarBucket = `boyar-${spinContext}`;
            const s3Endpoint = cloud.region == "us-east-1" ? "s3" : `s3-${cloud.region}`;
            const boyarConfigUrl = !isEmpty(cloud.bootstrapUrl) ? cloud.bootstrapUrl : `https://${s3Endpoint}.amazonaws.com/${boyarBucket}/${boyarKey}`;

            contentAsString += `s3_bucket_name="${boyarBucket}"\n`
            contentAsString += `s3_boyar_key="${boyarKey}"\n`
            contentAsString += `s3_boyar_config_url="${boyarConfigUrl}"\n`

            if (isBoolean(keys.orbs.ethereum)) {
                contentAsString += `ethereum_count=${keys.orbs.ethereum ? 1 : 0}\n`
            }
        }

        return contentAsString;
    }

    resolveHome(filepath) {
        if (filepath[0] === '~') {
            return path.join(process.env.HOME, filepath.slice(1));
        }
        return filepath;
    }

    async writeTerraformVariablesFile({ spinContext, cloud, keys }) {
        const contentAsString = this.createTerraformVariablesFile({ spinContext, cloud, keys });
        const target = path.join(this.contextDirPath(spinContext), "terraform.tfvars");

        await this.adapter.writeFile(target, contentAsString);
    }

    async copyTerraformInfraTemplate({ cloud, spinContext }) {
        const sourcePath = path.join(terraformResourcesBasePath, cloud.type);
        const targetPath = this.contextDirPath(spinContext);

        const copyResult = await this.adapter.copyInfraBaseTemplate({ sourcePath, targetPath });
        if (isError(copyResult)) {
            return copyResult;
        }

        if (copyResult.exitCode !== 0) {
            return new Error(`Copy Terraform infra base has failed! Process said: ${copyResult.stderr}`);
        }

        if (cloud.ip) {
            const copyEipResult = await this.adapter.copyInfraEipTemplate({ sourcePath, targetPath });
            if (isError(copyEipResult)) {
                return copyEipResult;
            }

            if (copyEipResult.exitCode !== 0) {
                return new Error(`Copy Terraform Elastic IP template has failed! Process said: ${copyEipResult.stderr}`);
            }
        }

        const copyEthEbsResult = await this.adapter.copyInfraEbsTemplate({ sourcePath, targetPath });

        if (isError(copyEthEbsResult)) {
            return copyEthEbsResult;
        }

        return true;
    }

    async copyStackScripts({ spinContext }) {
        const sourcePath = path.join(resourcesBasePath, 'swarm/ethereum-node.yml');
        const targetPath = this.contextDirPath(spinContext);

        const result = await this.adapter.copySwarmStackScripts({ sourcePath, targetPath });
        if (isError(result)) {
            return result;
        }

        if (result.exitCode !== 0) {
            return new Error(`Could not copy stack scripts! Process said: ${copyResult.stderr}`);
        }

        return true;
    }

    async init({ spinContext }) {
        const targetPath = this.contextDirPath(spinContext);
        const { code } = await this.adapter.init({ spinContext, targetPath }).catch(err => err);
        if (code !== 0) {
            return new Error('Could not perform Terraform init phase!');
        }
        return true;
    }

    async importExistingIp({ spinContext, cloud }) {
        const targetPath = this.contextDirPath(spinContext);

        const { code } = await this.adapter.importExistingIp({ spinContext, targetPath, cloud }).catch(err => err);
        if (code !== 0) {
            return new Error('Could not perform Terraform import of existing Elastic IP phase!');
        }

        return true;
    }

    parseOutputs(str) {
        return str
            .split('\n')
            .map((_item) => {
                if (_item.indexOf(' = ') === -1) {
                    return null;
                }

                const item = _item.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

                const outputParts = item.split(' = ');
                const key = trim(outputParts[0]);
                const value = trim(outputParts[1]);

                return {
                    key,
                    value
                };
            })
            .filter(output => output !== null);
    }

    async apply({ spinContext }) {
        const targetPath = this.contextDirPath(spinContext);
        let outputs = [];
        let outputsStarted = false;

        const stdoutHandler = (dataAsString) => {
            // Search for the public IP of the cluster manager node.
            if (dataAsString.indexOf('Outputs:') !== -1) {
                outputsStarted = true;
            }

            if (outputsStarted && dataAsString.indexOf(' = ') !== -1) {
                outputs = outputs.concat(this.parseOutputs(dataAsString));
            }
        };

        const result = await this.adapter.apply({ spinContext, targetPath, stdoutHandler }).catch(err => err);
        if (result.code !== 0) {
            return new Error('Could not perform Terraform apply phase!');
        }

        return Object.assign({}, result, { outputs });
    }

    async destroy({ spinContext }) {
        const spinner = ora('Perform initial checks').start();
        const targetPath = this.contextDirPath(spinContext);

        if (this.adapter.checkFileExists(path.join(targetPath, '.eip'))) {
            console.log('Detaching Elastic IP from Terraform context...');
            // Looks like an Elastic IP was imported to this Terraform build
            // Let's detach it from Terraform so that we don't destroy it.
            const detachResult = await this.adapter.detachElasticIPFromTerraformState({ targetPath });

            if (detachResult.exitCode !== 0) {
                spinner.fail();
                console.log('');
                console.log('');
                console.log(detachResult.stderr);

                return detachResult;
            }
        }
        spinner.succeed();
        spinner.start(`Destroying constellation ${spinContext} resources in AWS `);

        const result = await this.adapter.destroy({ spinContext, targetPath }).catch(err => err);
        if (result.code !== 0) {
            spinner.fail();
            console.log('');
            console.log('');
            console.log(this.adapter.outputs[spinContext].ops['tf-destroy'].err.join('\n'));

            return new Error('Could not perform Terraform destroy phase!');
        }

        spinner.succeed();

        return result;
    }

    async spinUp({ cloud, keys }) {
        const eip = 'ip' in cloud;
        if (!cloud.ethereum) {
            cloud.ethereum = {};
        }

        const spinContext = cloud.spinContext || uuid();
        const target = path.join(this.tmpBasePath(), spinContext);

        const spinner = ora('Performing initial checks').start();

        // TODO: Maybe split this into a different part of the system.
        await this.createSpinContextDirectory({ target });
        await new Promise((r) => { setTimeout(r, 1000); });
        spinner.succeed();
        spinner.start(`Generating Terraform code at ${target} `);

        await this.writeTerraformVariablesFile({ spinContext, cloud, keys });
        await this.copyTerraformInfraTemplate({ cloud, spinContext });
        await this.copyStackScripts({ spinContext });

        spinner.succeed();

        spinner.start(`Terraform initialize`);
        // First step is to init terraform
        const initResult = await this.init({ spinContext });
        if (isError(initResult)) {
            spinner.fail();
            console.log('');
            console.log('');
            console.log(this.adapter.outputs[spinContext].ops['init'].err.join('\n'));

            return {
                ok: false,
                tfPath: target,
                message: 'Terraform init has failed (logs are inline)',
                error: initResult,
            };
        }

        spinner.succeed();

        if (eip) {
            spinner.start(`Importing IP ${cloud.ip}`);
            // If we need to bind the manager to an existing Elastic IP then let's import
            // it into our terraform execution context directory.
            const eipImportResult = await this.importExistingIp({ spinContext, cloud });
            if (isError(eipImportResult)) {
                spinner.fail();
                console.log('');
                console.log('');
                console.log(this.adapter.outputs[spinContext].ops['import-ip'].err.join('\n'));

                return {
                    ok: false,
                    tfPath: target,
                    message: 'Terraform importing of an existing Elastic IP has failed (logs are inline)',
                    error: eipImportResult,
                };
            }
            spinner.succeed();
        }

        spinner.start(`Creating constellation ${cloud.spinContext} on AWS`);

        const applyResult = await this.apply({ spinContext });
        if (isError(applyResult)) {
            spinner.fail();
            console.log('');
            console.log('');
            console.log(this.adapter.outputs[spinContext].ops['tf-apply'].err.join('\n'));

            return {
                ok: false,
                tfPath: target,
                message: 'Terraform apply has failed (logs are inline)',
                error: applyResult,
            };
        }

        spinner.succeed();

        if (eip) {
            applyResult.outputs[applyResult.outputs.findIndex(o => o.key === 'manager.ip')].value = cloud.ip;
        }

        return {
            ok: true,
            tfPath: target,
            outputs: applyResult.outputs,
            spinContext,
        };
    }

    async spinDown({ spinContext }) {
        const result = await this.destroy({ spinContext });
        if (isError(result)) {
            return {
                ok: false,
                message: 'Terraform destroy has failed (logs are inline)',
                error: result,
            };
        }

        return {
            ok: true,
            error: null,
        };
    }
}

module.exports = {
    TerraformService,
};
