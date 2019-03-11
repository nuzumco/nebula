# Setting up an Orbs Public Blockchain Node using Nebula CLI

This step-by-step guide will walk you through creating a new node and connecting it to an existing Orbs network.

![](../diagram.png)

## Prerequisites

To complete this guide you will need the following set up:

- Mac or Linux machine
- An SSH public key (by default we use `~/.ssh/id_rsa.pub`). We go into details on how to generate these below
- **A clean, new AWS account with admin programmatic access.**
- AWS CLI
  
  Use `brew install awscli` to get it installed
- An AWS credentials profile set correctly:
  
  See more [here](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html)
  
  We require the `aws_access_key_id` and `aws_secret_access_key` of an admin account for our Terraform script to execute correctly 
- [Node.js](https://nodejs.org/en/) version 8 or above
  
  Use `brew install node` to get it installed

- [Terraform](https://www.terraform.io/downloads.html) from HasiCorp
  
  Use `brew install terraform` to get it installed
- [Orbs Key Generator](https://www.github.com/orbs-network/orbs-key-generator)

  Use `brew install orbs-network/devtools/orbs-key-generator` to get it installed (requires a Mac)

### Generating SSH public and private keys

We require a valid public/private keys to run our deployment scripts and set up the EC2 resources. The key file should remain secret with the exception of feeding it to the configuration during setup. (providing the path for the pub file in the `node.json` setup file as described below)

The generated key should __not__ have a passphrase.
It is okay to generate a key by any means, such as based on the following tutorial by [GitHub](https://help.github.com/articles/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent/)

The gist of creating such a key is running:

    ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

### Allocating an IP on Amazon

The Orbs node that you provision must have a static IPs in order to communicate with the network.

- Go to your AWS Console
- Pick a region (for example `ca-central-1`)
- Allocate 1 Elastic IPs

That IP address and region will later be used in the node configuration file.


### Generating Orbs addresses

An Orbs node is identified by a public key and any action of the node should be signed with the corresponding private key. 
These keys should be generated in a secure fashion and the private key should be securely stored. 

We require an Orbs private key and an Orbs address. These can be generated using the [Orbs key generator](https://github.com/orbs-network/orbs-key-generator) by running `orbs-key-generator node`

The output of the key generator should be securely stored and used in the `node.json` configuration file as explained below. You will need the `NodeAddress` and `NodePrivateKey` later on __without the leading 0x__.

### Install Nebula via NPM

To install Nebula run

    npm install -g orbs-nebula

If you have previously installed Nebula, you can run the `npm update -g orbs-nebula`

### Locate the example files

We require a `node.json` configuration file to run Nebula, you can find one which contains example data here 

    https://github.com/orbs-network/nebula/blob/master/public/node.json

You will need to configure this JSON file with the correct parameters for your node.

### Configure the boilerplate JSON file

The thing to do next is to open up the `node.json` file and configure it as required for the new node.

Create a `node.json` file with the following information:

    {
        "name": "$VALIDATOR_NAME-orbs-node",
        "awsProfile": "default",
        "sshPublicKey": "$LOCATION_TO_PUB_FILE",
        "orbsAddress": "$ORBS_PUBLIC_NODE_ADDRESS",
        "orbsPrivateKey": "$ORBS_PRIVATE_KEY", 
        "publicIp": "$NODE_AWS_IP",
        "region": "$NODE_AWS_REGION",
        "nodeSize": "t2.medium",
        "nodeCount": 2,
        "chainVersion": "v0.8.0",
        "bootstrapUrl": "https://s3.amazonaws.com/boyar-bootstrap-test/boyar/config.json"
    }

You will need:
* $VALIDATOR_NAME-orbs-node - Name for your Validator name, such as a company name or brand name.
* $NODE_AWS_IP - The IP address (from AWS)
* $NODE_AWS_REGION - The AWS region (from AWS)
* $LOCATION_TO_PUB_FILE - The SSH publc and private key file path (the generated pub file)
* $ORBS_PUBLIC_NODE_ADDRESS - The Orbs node address (from the Orbs key generator - without the leading 0x)
* $ORBS_PRIVATE_KEY - The Orbs node private key (from the Orbs key generator - without the leading 0x)

### Run Nebula CLI to deploy the node

To provision the resources required for the node:

    nebula create -f node.json

To remove all resources provisioned for the node:

    nebula destroy -f node.json

Terraform files corresponding to nodes can be found in `~/.nebula/$NODE_NAME`, for example, `~/.nebula/example-public-node1`.

### Registering to the Orbs public network

Please send the following details to your Orbs contact to register with the network:

* `name` - The node name, as configured in the `node.json` file
* `orbsAddress` - The node Orbs address, as configured in the `node.json` file
* `publicIp` - The node public IP address, as configured in the `node.json` file
* `region` - The AWS region that was used, as configured in the `node.json` file

__Important - do not send Orbs, or any other party, the Orbs or SSH private key, or AWS credentials__

### What happens after deployment

Once the node becomes operational, it will bootstrap the network configuration from the setup (currently from a shared AWS S3 object), and will attempt to join the network and sync. Joining the network will work once the network configuration file includes the new node parameters (result of the network registration described above).

### How to inspect the network health

At this point your node has joined the network and should be syncing the existing blocks.

To inspect your node operation on every virtual chain, Orbs has developed a special inspection route available on each node that provides access to node metrics.
To access the metrics, navigate to `http://$NODE_IP/vchains/2019/metrics` replacing __$NODE_IP__ with 
your node IP.

The JSON you see will include a property called `BlockStorage.BlockHeight`, which indicates the block height that the network is currently on.
Try refreshing this metrics page a couple of times, you should see this value increasing.

If this is the case it means that the network is alive and healthy. 

__Congratulations!__

## Troubleshooting

1. If you get an Terraform error that your IP does not exist, check whether the combination of ip and region is correct in the node configuration file (`public/node.json`)

2. If new blocks are not being created, it is possible that your node is not registered with Orbs. Check to see that it is in https://s3.amazonaws.com/boyar-bootstrap-test/boyar/config.json. Also verify that port `4400` is open

3. If you are trying to destroy all blocks history, you have to manually remove all EBS volumes with names `orbs-network-chain-*`. The destroy operation will not remove data persistence.

4. Contact Orbs for any other issues

### Known issues

- `nodeCount` that is not equal `2` is *not supported* (Docker Swarm cluster can only have 2 workers at the moment)
