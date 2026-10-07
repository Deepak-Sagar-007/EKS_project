# EKS DevOps Practice Project

Frontend (nginx) -> Backend (Node/Express) -> PostgreSQL (StatefulSet + EBS volume) on Amazon EKS,
deployed entirely with GitHub Actions.

## Structure
- `infra/cluster.yaml`  - eksctl cluster config (region ap-south-1, 1 x t3.medium, EBS CSI driver)
- `backend/`, `frontend/` - app code + Dockerfiles
- `k8s/` - Kubernetes manifests
- `.github/workflows/infra.yml`  - create/destroy the cluster (manual)
- `.github/workflows/deploy.yml` - build images, push to ECR, deploy (on push to main)

## Setup
1. Create an IAM user (practice only: AdministratorAccess) and an access key.
2. Push this repo to GitHub.
3. Repo -> Settings -> Secrets and variables -> Actions -> add:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `DB_PASSWORD` (any strong password)
4. Actions tab -> "1 - EKS Cluster" -> Run workflow -> `create` (~15-20 min).
5. Push any change to `main` (or run "2 - Build and Deploy App" manually).
6. Open the App URL printed in the job summary.

## Clean up (important, to stop charges)
Actions -> "1 - EKS Cluster" -> Run workflow -> `destroy`.
Then delete the ECR repos `demo-backend` and `demo-frontend` in the AWS console.

## Useful commands
    aws eks update-kubeconfig --name devops-eks --region ap-south-1
    kubectl -n demo get pods,svc,pvc
    kubectl -n demo logs deploy/backend
