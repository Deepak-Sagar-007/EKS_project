# Hands-On Guide: Frontend + Backend + Database on Amazon EKS with GitHub Actions

You will build and run this:

```
Browser ──► AWS Load Balancer ──► frontend (nginx) ──/api──► backend (Node) ──► PostgreSQL (+ EBS disk)
                    └──────────── all inside an EKS cluster, namespace "demo" ────────────┘

GitHub repo ──► GitHub Actions ──► builds Docker images ──► ECR ──► kubectl apply ──► EKS
```

**Time:** about 1.5 hours (about 20 minutes of that is waiting for AWS). **Cost:** about $0.20/hr while the cluster exists, so destroy it at the end (Step 12).

---

## Concepts you will learn (read once, then see them live)

| Concept | What it is | Where you will see it |
|---|---|---|
| **Docker image** | Your app and its dependencies packaged as one runnable unit | `backend/Dockerfile`, `frontend/Dockerfile` |
| **ECR** | AWS's private Docker image registry | Created by `deploy.yml` |
| **EKS** | Managed Kubernetes. AWS runs the control plane and you run the worker nodes | `infra/cluster.yaml` |
| **eksctl** | CLI that creates the VPC, EKS cluster, and nodes through CloudFormation | `infra.yml` |
| **Node** | An EC2 server that runs your containers | 1 x t3.medium |
| **Pod** | The smallest unit that runs on a node, wrapping one or more containers | `kubectl get pods` |
| **Deployment** | Keeps N identical pods running and handles rolling updates | `backend.yaml`, `frontend.yaml` |
| **StatefulSet** | Like a Deployment, but with a stable name and its own disk, for databases | `postgres.yaml` |
| **PVC / StorageClass** | A request for a disk, and the type of disk to create. The EBS CSI driver makes the real EBS volume | `storageclass.yaml` |
| **Service** | A stable network name and IP in front of pods | `backend`, `postgres`, `frontend` |
| **Service type LoadBalancer** | Makes AWS create a public load balancer | `frontend.yaml` |
| **Secret** | Stores sensitive values such as the DB password | Created in `deploy.yml` from a GitHub secret |
| **Probes** | Kubernetes health checks (readiness and liveness) | `backend.yaml` |
| **CI/CD** | Every push automatically builds and deploys | `.github/workflows/` |

---

## Step 0: Prerequisites

- An AWS account (the trial is fine) and a GitHub account.
- Installed on your computer: **Git**, **AWS CLI v2**, and **kubectl**. The CLI tools are optional, but you need them to inspect the cluster, and that is where most of the learning happens.
  - Check with: `git --version`, `aws --version`, `kubectl version --client`.

## Step 1: Protect your wallet

1. In the AWS console, search for **Budgets**, then **Create budget**, choose **Zero spend** or a **monthly budget of $10**, and add your email.
2. Set the region (top right) to **Asia Pacific (Mumbai) ap-south-1**. This matches the config files.

## Step 2: Create an IAM user and access key for GitHub Actions

GitHub Actions needs credentials to act on your AWS account.

1. Console, then **IAM**, then **Users**, then **Create user**. Name it `github-actions-eks`.
2. **Attach policies directly** and select **AdministratorAccess**. This is acceptable for practice only. Production would use a least-privilege role.
3. Open the user, go to **Security credentials**, then **Create access key**, choose **Command Line Interface**, and create it.
4. **Copy the Access Key ID and Secret Access Key now.** The secret is shown only once.

> Concept: this user will be the **creator** of the EKS cluster, so it automatically gets cluster-admin rights. That is why the same keys later work with `kubectl`.

## Step 3: Put the code on GitHub

1. Unzip `eks-devops-project.zip`.
2. On GitHub, click **New repository**, name it `eks-devops-project`, and keep it empty (no README).
3. In a terminal inside the unzipped folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/eks-devops-project.git
git push -u origin main
```

(When asked for a password, GitHub needs a Personal Access Token, or use GitHub Desktop or `gh auth login`.)

> **Expected:** the push triggers the *Build and Deploy* workflow, and it **will fail** because no cluster exists yet. That is fine. You'll rerun it in Step 6. This teaches you that a deploy pipeline depends on infrastructure existing first.

## Step 4: Add secrets to GitHub

Repo, then **Settings**, then **Secrets and variables**, then **Actions**, then **New repository secret**. Add three:

| Name | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | from Step 2 |
| `AWS_SECRET_ACCESS_KEY` | from Step 2 |
| `DB_PASSWORD` | any password, for example `MyStr0ngPass123` (letters and digits only avoids quoting problems) |

> Concept: secrets are encrypted by GitHub and masked in logs. The workflow turns `DB_PASSWORD` into a Kubernetes Secret, which both the backend and Postgres read. The password is never in your code.

## Step 5: Create the EKS cluster (Workflow 1)

1. Repo, then **Actions**, then **1 - EKS Cluster (create / destroy)**, then **Run workflow**, choose **create**, and run it.
2. Open the running job and expand **Create cluster**. Watch the log while you wait 15–20 minutes. You will see eksctl creating, in order: a VPC and subnets, the EKS control plane, a managed node group (an EC2 instance), and the EBS CSI driver add-on.
3. While waiting, look in the AWS console at **CloudFormation**. You will see two stacks, `eksctl-devops-eks-cluster` and `eksctl-devops-eks-nodegroup-ng-1`. This is how eksctl works under the hood.

**Verify when green:**
- Console, then **EKS**, then **Clusters**: `devops-eks` is **Active**.
- Console, then **EC2**, then **Instances**: one `t3.medium` is running.

## Step 6: Connect your laptop to the cluster

```bash
aws configure          # paste the access key ID, secret key, region: ap-south-1, output: json
aws eks update-kubeconfig --name devops-eks --region ap-south-1
kubectl get nodes
```

You should see one node in `Ready` status. `update-kubeconfig` wrote the cluster address and credentials into `~/.kube/config`.

Explore the cluster that is running before you deploy anything:

```bash
kubectl get namespaces
kubectl get pods -n kube-system     # coredns, aws-node, kube-proxy, ebs-csi-*
```

These are the system components. Notice the `ebs-csi` pods, which will create the database disk.

## Step 7: Deploy the app (Workflow 2)

Go to **Actions**, then **2 - Build and Deploy App**, then **Run workflow**. Here is what each step does:

| Step | What happens | Concept |
|---|---|---|
| Login to ECR | Gets a temporary Docker login | Registry auth |
| Ensure ECR repos exist | Creates `demo-backend` and `demo-frontend` | Registry |
| Build and push images | Builds both Dockerfiles and tags images with the commit SHA | Immutable tags, so every deploy is traceable |
| Configure kubectl | Same as your `update-kubeconfig` | Cluster access |
| Deploy namespace, storage, secret, DB | Applies the YAML and waits for Postgres | Ordering: the DB must be ready first |
| Deploy backend and frontend | `sed` swaps the `BACKEND_IMAGE` placeholder for the real image, then applies | Image injection |
| Show app URL | Waits for the AWS load balancer hostname | Service type LoadBalancer |

When it finishes, open the run's **Summary** page and copy the **App URL** (`http://xxxx.ap-south-1.elb.amazonaws.com`). The DNS name can take 1–2 minutes before it resolves, so refresh if needed.

## Step 8: Use and verify the app

1. Open the URL, add a few tasks, then refresh. They persist because they are stored in Postgres.
2. Inspect everything from your terminal:

```bash
kubectl -n demo get pods           # postgres-0, backend-xxx, frontend-xxx all Running
kubectl -n demo get svc            # frontend has an EXTERNAL-IP (the load balancer)
kubectl -n demo get pvc            # data-postgres-0 is Bound (your EBS disk)
kubectl -n demo logs deploy/backend
```

3. Look in the AWS console under **EC2, then Volumes** (a 5 GB gp3 volume) and **EC2, then Load Balancers**. Kubernetes created both for you.

## Step 9: Experiments (this is where the learning happens)

**A. Self-healing.** Delete the backend pod and watch it come back:
```bash
kubectl -n demo delete pod -l app=backend
kubectl -n demo get pods -w        # Ctrl+C to stop
```
The Deployment notices that the actual state differs from the desired state and recreates the pod.

**B. Data persistence.** Delete the database pod, then refresh the app:
```bash
kubectl -n demo delete pod postgres-0
```
Your tasks are still there, because the EBS volume (PVC) outlives the pod. Try the same experiment on a plain Deployment with no volume and you would lose the data.

**C. Look inside the database.**
```bash
kubectl -n demo exec -it postgres-0 -- psql -U appuser -d appdb -c "SELECT * FROM tasks;"
```

**D. Talk to the backend directly (bypassing the frontend).**
```bash
kubectl -n demo port-forward svc/backend 3000:3000
# in another terminal:
curl localhost:3000/health
curl localhost:3000/api/tasks
```

**E. Scaling.**
```bash
kubectl -n demo scale deployment/backend --replicas=3
kubectl -n demo get pods -o wide
```
Reload the app and it still works, and the Service balances traffic across the replicas. (Note that the pods may stay `Pending` if the single node runs out of capacity. Run `kubectl -n demo describe pod <name>` to find out why.)

**F. Real CI/CD: change the code and push.** Edit `frontend/index.html` (change the `<h1>` text), then:
```bash
git add . && git commit -m "Change title" && git push
```
Watch Actions run automatically. A new image tagged with the new commit SHA is deployed using a **rolling update**, so the new pod starts before the old one stops. Refresh the app to see your change. Check history with `kubectl -n demo rollout history deploy/frontend`.

**G. Break it on purpose.** Change the `DB_PASSWORD` secret in GitHub, rerun the deploy, and watch the backend fail to connect (`kubectl -n demo logs deploy/backend`). Postgres keeps the password it was first created with, which is why the app can't connect. This is a classic real-world problem.

**H. Rollback.**
```bash
kubectl -n demo rollout undo deploy/frontend
```

## Step 10: How the pieces talk to each other

- The browser requests `/` and `/api/tasks` from the **same** load balancer address.
- **nginx** (`frontend/nginx.conf`) serves the HTML for `/` and forwards `/api/` to `http://backend:3000`. The name `backend` resolves through Kubernetes DNS to the backend **Service**.
- The **backend** connects to host `postgres`, which is the Postgres Service, using the password from the Secret.
- Postgres is not exposed to the internet. Only pods inside the cluster can reach it, and only the frontend Service has a public address.

## Step 11: Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Workflow 1 fails with a quota or vCPU error | New account. Request an EC2 quota increase or wait for verification. |
| Workflow 1 fails with a plan or permission error | Free plan restriction. Upgrade to the paid plan in Billing (credits still apply). |
| Deploy fails at "Configure kubectl" | The cluster doesn't exist yet or was destroyed. Run workflow 1. |
| `postgres-0` stuck `Pending` | PVC problem. Run `kubectl -n demo describe pvc data-postgres-0` and check the EBS CSI pods in `kube-system`. |
| `ImagePullBackOff` | The image tag is wrong or the node can't reach ECR. Run `kubectl -n demo describe pod <name>`. |
| `CrashLoopBackOff` on backend | Run `kubectl -n demo logs deploy/backend`. It is usually a DB password or connection problem. |
| App URL doesn't load | Wait 2 minutes for DNS, then check `kubectl -n demo get svc frontend`. |
| `kubectl` shows "Unauthorized" | Your `aws configure` keys must belong to the IAM user that created the cluster. |

Your three best debugging commands are `kubectl get pods`, `kubectl describe pod <name>`, and `kubectl logs <name>`.

## Step 12: Clean up (do not skip)

1. **Actions**, then **1 - EKS Cluster**, then **Run workflow**, choose **destroy**. This deletes the app and load balancer first, then the cluster (about 10–15 minutes).
2. Delete the ECR repos: console, then **ECR**, select `demo-backend` and `demo-frontend`, then **Delete**.
3. Check the console for leftovers: **EC2, then Volumes**, **EC2, then Load Balancers**, and **CloudFormation** stacks. Delete anything related to `devops-eks`.
4. Optionally deactivate or delete the IAM access key.
5. Check **Billing, then Bills** the next day to confirm charges have stopped.

## Next steps to level up

1. Replace access keys with **GitHub OIDC and an IAM role** (no stored secrets).
2. Add an **Ingress** with the AWS Load Balancer Controller and HTTPS.
3. Move Postgres to **Amazon RDS**.
4. Rebuild the cluster with **Terraform**.
5. Package the manifests as a **Helm chart**.
6. Add monitoring with **Prometheus and Grafana**.
