System Prompt / Task Specification: Smart City Traffic Analytics
1. Project Overview
Project Name: Smart City Application in Trade Corridors

Objective: Use AI to process real-world road surveillance video, detect traffic flow, and generate actionable insights.

Target User: Department of Transportation / Urban Traffic Management Authorities

2. Input & Output Schema
Input Data
Source: Actual road CCTV/surveillance footage.

Content: Video data capturing multi-directional traffic:

Ongoing traffic (straight)

Oncoming traffic (opposite direction)

Left-turning vehicles

Cross-intersection traffic

Output Deliverable
Format: A single-page Web Dashboard hosted on localhost.

Design Freedom: The UI layout and form are entirely flexible and open to creative expression.

Core Requirements: The dashboard must be highly creative, intuitive, and easy for non-technical government officials to understand at a glance. It must visualize:

Vehicle detection & Classification (Object classification)

Traffic counting & Time-period statistics

3. Reference Execution Pipeline (Adjustable)
Execute the following workflow to transform raw video into intuitive traffic intelligence:

Stage 1: Data Insight & Problem Definition
Task: Analyze the input video's environment.

Parameters: Identify camera angle, video quality, traffic flow directions, road geometry, and optimal virtual counting line positions.

Stage 2: AI Vehicle Detection & Counting Model
Task: Implement object detection and tracking.

Technical Guide: Use SOTA models like YOLO to identify target classes (cars, motorcycles, buses, etc.) and count them as they cross designated virtual lines.

Stage 3: Core Logic – Decision-Making Transformation [CRITICAL]
Task: Translate raw numeric data into concrete, actionable traffic optimization advice (e.g., signal timing adjustments, lane re-allocation during peak hours).

Stage 4: Creative Dashboard Generation
Task: Build and deploy the localhost dashboard.

UX/UI Goal: Avoid cluttered spreadsheets. Use creative, visual, and highly digestible layouts to display:

Total traffic volume & Flow rate

Vehicle type distribution ratio

Directional flow analytics

Congestion hotspots & Congestion indices

Outcome: Enable users to instantly grasp current road conditions and effortlessly support traffic management decisions.